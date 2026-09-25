import {
  BinaryReader,
  BinaryWriter,
  Configuration,
  Decoder,
  Encoder,
  ILoggerFactory,
  LoggerFactory,
  registerBinaryDecoders,
  registerEncoders,
  registerTypeDecoders
} from "opcjs-base";

import type { SecurityConfiguration } from '../securityConfiguration.js'

export class ConfigurationClient extends Configuration {
  /**
   * Optional security restrictions applied during `Client.connect()`.
   * When not set, permissive defaults are used (SecurityPolicy None allowed,
   * all user-token types accepted).
   *
   * @see SecurityConfiguration
   */
  public securityConfiguration?: SecurityConfiguration

  /**
   * How long to wait (ms) before attempting a reconnect after a server-shutdown
   * is detected via `ServerStatus/State = Shutdown` or a subscription
   * `StatusChangeNotification` with `BadShutdown` / `BadServerHalted`.
   *
   * Gives the server process time to exit fully before the client tries to
   * re-connect.  Defaults to 5 000 ms.
   */
  public shutdownReconnectDelayMs = 5_000

  /**
   * Minimum reconnect delay in milliseconds used when
   * `Server/ServerStatus/EstimatedReturnTime` is already in the past (the server
   * should already be available again).
   *
   * Also acts as the lower bound for the ERT-derived delay, ensuring the client
   * always waits at least this long before retrying.
   *
   * Defaults to 1 000 ms.
   */
  public minReconnectDelayMs = 1_000

  /**
   * How often (ms) the keep-alive timer reads `Server_ServerStatus` when no subscription
   * publish loop is active. Must be shorter than the server's `revisedSessionTimeout`
   * (default: 60 000 ms). Also the polling interval for the `ServerStatus/State = Shutdown`
   * detection path (Session Client Detect Shutdown conformance unit).
   *
   * Defaults to 25 000 ms.
   */
  public keepAliveIntervalMs = 25_000
  public static getSimple(
    name: string,
    company: string,
    loggerFactory?: ILoggerFactory,
  ): ConfigurationClient {

    if (!loggerFactory) {
      loggerFactory = new LoggerFactory({
        defaultLevel: 'DEBUG', //todo: use enum
        categoryLevels: {
          "transport.*": "TRACE",
          "secureChannel.*": "TRACE",
        },
      });
    }
    const applicationUri = `urn:${company}:${name}`;
    const productUri = `urn:${company}:${name}:product`;

    const encoder = new Encoder();
    encoder.registerWriterFactory("binary", () => {
      return new BinaryWriter();
    });
    registerEncoders(encoder);

    const decoder = new Decoder();
    decoder.registerReaderFactory("binary", (data: unknown) => {
      return new BinaryReader(data as Uint8Array);
    });
    registerTypeDecoders(decoder);
    registerBinaryDecoders(decoder);

    return new ConfigurationClient(
      name,
      applicationUri,
      name,
      productUri,
      encoder,
      decoder,
      loggerFactory,
    );
  }

  constructor(
    applicationName: string,
    applicationUri: string,
    productName: string,
    productUri: string,
    encoder: Encoder,
    decoder: Decoder,
    loggerFactory: ILoggerFactory,
  ) {
    super(
      applicationName,
      applicationUri,
      productName,
      productUri,
      encoder,
      decoder,
      loggerFactory,
    );
  }
}
