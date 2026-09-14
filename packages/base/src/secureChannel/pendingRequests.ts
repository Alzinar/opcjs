import { IOpcType } from "../types/iOpcType";

type Resolver = {
  resolve: (response: IOpcType) => void;
  reject:  (error: Error) => void;
};

/**
 * Rejection reason used by {@link PendingRequests.failAll} when the channel is
 * closed (explicitly or because the transport ended) rather than because a
 * request actually failed.  Lets callers tell "nothing to worry about, the
 * channel is just gone" apart from real protocol errors (`ServiceFault`,
 * `Abort`, decode errors, ...) without treating a normal shutdown as one.
 */
export class ChannelClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelClosedError";
  }
}

/**
 * Correlates outgoing OPC UA service requests with their incoming responses.
 *
 * {@link SecureChannelWritable} registers a pending entry (keyed by `requestId`)
 * before sending each message.  {@link SecureChannelReadable} calls
 * {@link settle} when the matching response arrives.
 *
 * Responses with no registered requestId are unsolicited (e.g. Publish
 * notifications) and should be forwarded to the readable side instead.
 */
export class PendingRequests {
  private readonly map = new Map<number, Resolver>();

  /**
   * Registers a pending request and returns a Promise that resolves once the
   * matching response is delivered via {@link settle}.
   */
  register(requestId: number): Promise<IOpcType> {
    return new Promise<IOpcType>((resolve, reject) => {
      this.map.set(requestId, { resolve, reject });
    });
  }

  /**
   * Resolves the pending promise for `requestId`.
   * @returns `true` if a matching entry was found and settled, `false` otherwise.
   */
  settle(requestId: number, response: IOpcType): boolean {
    const resolver = this.map.get(requestId);
    if (!resolver) return false;
    this.map.delete(requestId);
    resolver.resolve(response);
    return true;
  }

  /**
   * Rejects the pending promise for `requestId` (e.g. on ServiceFault).
   * @returns `true` if a matching entry was found and rejected, `false` otherwise.
   */
  fail(requestId: number, error: Error): boolean {
    const resolver = this.map.get(requestId);
    if (!resolver) return false;
    this.map.delete(requestId);
    resolver.reject(error);
    return true;
  }

  /** Rejects all outstanding pending requests, e.g. on channel close. */
  failAll(error: Error): void {
    for (const resolver of this.map.values()) {
      resolver.reject(error);
    }
    this.map.clear();
  }
}
