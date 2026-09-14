import { ServiceFault } from "../schema/types";
import {
  MessageSecurityModeEnum,
  SecurityTokenRequestTypeEnum,
} from "../schema/enums";
import {
  OpenSecureChannelRequest,
  OpenSecureChannelResponse,
  RequestHeader,
} from "../schema/types";
import { BinaryReader } from "../codecs/binary/binaryReader";
import { ExtensionObject } from "../types/extensionObject";
import { IOpcType } from "../types/iOpcType";
import { NodeId } from "../types/nodeId";
import { MsgAsymmetric } from "./messages/msgAsymmetric";
import { MsgHeader } from "./messages/msgHeader";
import { MsgSecurityHeaderAsymmetric } from "./messages/msgSecurityHeaderAsymmetric";
import { MsgSecurityHeaderSymmetric } from "./messages/msgSecurityHeaderSymmetric";
import { MsgSequenceHeader } from "./messages/msgSequenceHeader";
import { MsgSymmetric } from "./messages/msgSymmetric";
import { MsgTypeAbort, MsgTypeFinal, MsgTypeOpenFinal } from "./messages/msgType";
import { ChannelClosedError, PendingRequests } from "./pendingRequests";
import { SecureChannelContext } from "./secureChannelContext";
import { getLogger } from "../utils/logger/loggerProvider";
import { MsgBase } from "./messages/msgBase";
import { ISecureChannel } from "./iSecureChannel";
import { Certificate } from "../certificates/certificate";

/**
 * Facade for the OPC UA Secure Conversation layer.
 *
 * Owns the correlation between outgoing requests and incoming responses.
 * Wires together {@link SecureChannelMessageDecoder} (inbound) and the raw
 * WebSocket writer (outbound) so callers only need to interact with this single
 * object.
 *
 * ```ts
 * const context  = new SecureChannelContext(configuration);
 * const facade   = new SecureChannelFacade(context, tcpHandler.readable, wsWritable);
 *
 * await facade.openSecureChannel();
 * const response = await facade.send(readValueRequest);
 *
 * // Unsolicited server messages (e.g. Publish notifications):
 * facade.unsolicited.pipeTo(notificationHandler.writable);
 * ```
 */
/** Fraction of the token lifetime at which a Renew request is proactively sent. */
const TOKEN_RENEW_FRACTION = 0.75

export class SecureChannelFacade implements ISecureChannel {
  private readonly pending = new PendingRequests();
  private readonly logger = getLogger("secureChannel.SecureChannelFacade");
  private readonly writer: WritableStreamDefaultWriter<MsgBase>;
  private readonly reader: ReadableStreamDefaultReader<MsgBase>;
  /** Timer handle for the scheduled token renewal; undefined when no renewal is pending. */
  private renewalTimer: ReturnType<typeof setTimeout> | undefined
  /** Set once `close()` has been called, so a graceful shutdown isn't mistaken for a connection loss. */
  private closed = false

  /**
   * Builds and sends an OpenSecureChannel request.
   * Called for both the initial Issue and subsequent Renew requests.
   *
   * On success the context `channelId` and `tokenId` are updated and a new
   * renewal is scheduled at 75 % of the server-revised token lifetime, per
   * OPC UA Part 4 Section 5.4.1 / Part 6 Section 6.7.3.
   */
  private async sendOpenSecureChannel(requestType: SecurityTokenRequestTypeEnum): Promise<void> {
    const requestHeader = new RequestHeader()
    requestHeader.authenticationToken = NodeId.newTwoByte(0)
    requestHeader.timestamp = new Date()
    requestHeader.requestHandle = 0
    requestHeader.returnDiagnostics = 0
    requestHeader.auditEntryId = ""
    requestHeader.timeoutHint = 0
    requestHeader.additionalHeader = ExtensionObject.newEmpty()

    const request = new OpenSecureChannelRequest()
    request.requestHeader = requestHeader
    request.clientProtocolVersion = 0
    request.requestType = requestType
    request.securityMode = this.context.securityPolicy.getSecurityMode()
    request.clientNonce = null
    request.requestedLifetime = 3600000

    const { sequenceNumber, requestId } = this.context.nextIds()

    // The asymmetric security algorithm must be set before encoding the message.
    this.context.securityAlgorithm = this.context.securityPolicy.getAlgorithmAsymmetric(
      new Uint8Array(),
      new Uint8Array(),
    )

    const msg = new MsgAsymmetric(
      new MsgHeader(MsgTypeOpenFinal, 0, this.context.channelId),
      new MsgSecurityHeaderAsymmetric(
        "http://opcfoundation.org/UA/SecurityPolicy#None",
      ),
      new MsgSequenceHeader(sequenceNumber, requestId),
      request,
    )

    const response = await this.pushMessage(msg) as OpenSecureChannelResponse

    this.context.channelId = response.securityToken?.channelId as number
    this.context.tokenId = response.securityToken?.tokenId as number
    this.context.securityAlgorithm = this.context.securityPolicy.getAlgorithmSymmetric(
      new Certificate(),
      new Certificate(),
    )

    // Schedule the next renewal at 75 % of the server-revised lifetime so the
    // client always holds a valid token.  Cancel any previous timer first.
    const revisedLifetimeMs = response.securityToken?.revisedLifetime as number
    this.scheduleRenewal(revisedLifetimeMs)
  }

  /**
   * Schedules a proactive token renewal at {@link TOKEN_RENEW_FRACTION} of
   * `lifetimeMs`.  Any previously scheduled renewal is cancelled first.
   */
  private scheduleRenewal(lifetimeMs: number): void {
    if (this.renewalTimer !== undefined) {
      clearTimeout(this.renewalTimer)
    }
    const delayMs = Math.floor(lifetimeMs * TOKEN_RENEW_FRACTION)
    this.logger.debug(
      `Scheduling SecurityToken renewal in ${delayMs} ms (75 % of ${lifetimeMs} ms lifetime).`,
    )
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = undefined
      this.logger.info("Renewing SecurityToken...")
      this.sendOpenSecureChannel(SecurityTokenRequestTypeEnum.Renew).catch((err: unknown) => {
        this.logger.error("SecurityToken renewal failed:", err)
      })
    }, delayMs)
  }

  /**
   * Sends the initial OpenSecureChannel request and resolves once the server
   * replies.  Updates `context.channelId` and `context.tokenId` on success
   * and schedules automatic renewal at 75 % of the token lifetime.
   */
  public openSecureChannel(): Promise<void> {
    this.logger.debug("Sending OpenSecureChannelRequest (Issue)...")
    return this.sendOpenSecureChannel(SecurityTokenRequestTypeEnum.Issue)
  }

  /**
   * Cancels any pending token renewal timer and releases the stream writer.
   * Call this when the secure channel is no longer needed.
   *
   * A graceful close does not reject any request still awaiting a response —
   * that's not a failure, so nothing is put on the pending queue for it. Any such
   * request is simply abandoned; see the `closed` check in `routeFrames()`.
   */
  public close(): void {
    this.closed = true
    if (this.renewalTimer !== undefined) {
      clearTimeout(this.renewalTimer)
      this.renewalTimer = undefined
    }
    this.writer.releaseLock()
  }

  // ─── ISecureChannel implementation ─────────────────────────────────────────────

  getSecurityPolicy(): string {
    return this.context.securityPolicy.getSecurityPolicyUri();
  }

  getSecurityMode(): MessageSecurityModeEnum {
    return this.context.securityPolicy.getSecurityMode();
  }

  getEndpointUrl(): string {
    return this.context.endpointUrl;
  }

  /**
   * Sends a service request and returns a Promise that resolves with the
   * matched response decoded by {@link SecureChannelReadable}.
   */
  issueServiceRequest(request: IOpcType): Promise<IOpcType> {
    const { sequenceNumber, requestId } = this.context.nextIds();
    const msg = new MsgSymmetric(
      new MsgHeader(MsgTypeFinal, 0, this.context.channelId),
      new MsgSecurityHeaderSymmetric(this.context.tokenId),
      new MsgSequenceHeader(sequenceNumber, requestId),
      request,
    );

    return this.pushMessage(msg);
  }

  // ─── Private methods ────────────────────────────────────────────────────────────────

  private async routeFrames(): Promise<void> {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) {
          // If we didn't ask for this (no prior close() call), the transport ended on
          // its own — that still means the connection is gone, so any pending request
          // (in particular a long-poll Publish) must be rejected instead of hanging
          // forever. A `close()`-initiated shutdown is not a failure, so it doesn't
          // reject anything here.
          if (!this.closed) {
            this.pending.failAll(new ChannelClosedError("SecureChannel connection closed"));
          }
          break;
        }

        if (!value) {
          this.logger.error("Received empty frame");
        }

        const requestId = value.sequenceHeader.requestId

        if (value.header.msgType === MsgTypeAbort) {
          // MSG+A: body is raw bytes containing StatusCode (UInt32) + Reason (String).
          // Fail only the matching pending request and clear any buffered chunks.
          const reader = new BinaryReader(value.body as Uint8Array)
          const statusCode = reader.readUInt32()
          const reason = reader.readString() as string
          this.context.chunkBuffers.delete(requestId)
          this.pending.fail(requestId, new Error(`Abort 0x${statusCode.toString(16).toUpperCase()}: ${reason}`))
        } else {
          const response = value.body as IOpcType
          if (response instanceof ServiceFault) {
            // A ServiceFault is the server’s error reply for one specific request.
            // Only fail that request — do not tear down all pending requests.
            // todo: better error out, log error
            this.pending.fail(requestId, new Error(`ServiceFault: ${JSON.stringify(response)}`))
          } else {
            this.pending.settle(requestId, response)
          }
        }
      }
    } catch (e) {
      // A read error after an explicit close() is an expected side effect of tearing
      // down the channel, not a failure worth reporting.
      if (this.closed) return
      const error = e instanceof Error ? e : new Error(String(e));
      this.pending.failAll(error);
    }
  }

  private async pushMessage(msg: MsgBase): Promise<IOpcType> {
    // Register before writing to avoid a race.
    const responsePromise = this.pending.register(msg.sequenceHeader.requestId);
    await this.writer.write(msg);
    return responsePromise;
  }

  // ─── Constructor ────────────────────────────────────────────────────────────────
  constructor(
    private readonly context: SecureChannelContext,
    private readerTransform: TransformStream<MsgBase, MsgBase>,
    private writerTransform: TransformStream<MsgBase, MsgBase>,
  ) {
    this.writer = this.writerTransform.writable.getWriter();
    this.reader = this.readerTransform.readable.getReader();
    void this.routeFrames();
  }
}
