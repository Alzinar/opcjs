import {
  BinaryReader,
  BinaryWriter,
  Configuration,
  Decoder,
  Encoder,
  ICertificateStore,
  ILoggerFactory,
  LoggerFactory,
  registerBinaryDecoders,
  registerEncoders,
  registerTypeDecoders,
} from 'opcjs-base'

/**
 * All options accepted by {@link OpcUaServer}.
 *
 * Merged into {@link ConfigurationServer} so a single object covers both the
 * OPC UA application identity and the transport/session parameters.
 */
export type ServerOptions = {
  /** Human-readable product name. Also used to derive `applicationUri` when that is omitted. */
  productName: string
  /** Company name used to derive `applicationUri` when that is omitted. Default: `'opcua'`. */
  company?: string
  /** Application URI identifying this server instance. Derived from `productName` + `company` when omitted. */
  applicationUri?: string
  /** TCP port the server listens on. Default: 4840. */
  port?: number
  /** Hostname or IP address to bind to. Default: `'localhost'`. */
  hostname?: string
  /** URL path of the OPC UA WebSocket endpoint. Default: `'/opcua'`. */
  endpointPath?: string
  /** Maximum session timeout in milliseconds. Default: 3 600 000 (1 hour). */
  sessionTimeoutMs?: number
  /** Maximum number of concurrent sessions. Default: 100. */
  maxSessions?: number
  /** Custom logger factory. When omitted a console logger is used. */
  loggerFactory?: ILoggerFactory
  /**
   * Certificate store used to serve this server's own application instance
   * certificate (Security Admin – Certificate Management conformance unit —
   * OPC UA Part 6, §6.2). When omitted, `CreateSessionResponse.serverCertificate`
   * remains `null` (current default behaviour).
   */
  certificateStore?: ICertificateStore
}

/**
 * Server-specific configuration extending the base {@link Configuration}.
 *
 * Use {@link ConfigurationServer.fromOptions} to create an instance from a
 * plain {@link ServerOptions} bag, or call {@link ConfigurationServer.getSimple}
 * for a quick development/test setup.
 */
export class ConfigurationServer extends Configuration {
  /** TCP port the server listens on. Default: 4840. */
  public port = 4840

  /** Hostname or IP address the server binds to. Default: `'localhost'`. */
  public hostname = 'localhost'

  /** URL path of the OPC UA WebSocket endpoint. Default: `'/opcua'`. */
  public endpointPath = '/opcua'

  /** Minimum allowed session timeout in milliseconds. Default: 10 000. */
  public minSessionTimeoutMs = 10_000

  /** Maximum allowed session timeout in milliseconds. Default: 3 600 000 (1 hour). */
  public maxSessionTimeoutMs = 3_600_000

  /** Maximum number of concurrent sessions. Default: 100. */
  public maxSessions = 100

  /**
   * Certificate store used to serve this server's own application instance
   * certificate (Security Admin – Certificate Management conformance unit).
   * When unset, `CreateSessionResponse.serverCertificate` stays `null`.
   */
  public certificateStore?: ICertificateStore

  /** Creates a {@link ConfigurationServer} from a plain {@link ServerOptions} bag. */
  public static fromOptions(options: ServerOptions): ConfigurationServer {
    const company = options.company ?? 'opcua'
    const cfg = ConfigurationServer.getSimple(options.productName, company, options.loggerFactory)
    if (options.applicationUri !== undefined) cfg.applicationUri = options.applicationUri
    if (options.port !== undefined) cfg.port = options.port
    if (options.hostname !== undefined) cfg.hostname = options.hostname
    if (options.endpointPath !== undefined) cfg.endpointPath = options.endpointPath
    if (options.sessionTimeoutMs !== undefined) cfg.maxSessionTimeoutMs = options.sessionTimeoutMs
    if (options.maxSessions !== undefined) cfg.maxSessions = options.maxSessions
    if (options.certificateStore !== undefined) cfg.certificateStore = options.certificateStore
    return cfg
  }

  /**
   * Creates a ready-to-use {@link ConfigurationServer} with binary codecs and a
   * console logger registered. Suitable for development and testing.
   */
  public static getSimple(
    name: string,
    company: string,
    loggerFactory?: ILoggerFactory,
  ): ConfigurationServer {
    if (!loggerFactory) {
      loggerFactory = new LoggerFactory({
        defaultLevel: 'DEBUG',
        categoryLevels: {
          'transport.*': 'TRACE',
          'secureChannel.*': 'TRACE',
        },
      })
    }

    const applicationUri = `urn:${company}:${name}`
    const productUri = `urn:${company}:${name}:product`

    const encoder = new Encoder()
    encoder.registerWriterFactory('binary', () => new BinaryWriter())
    registerEncoders(encoder)

    const decoder = new Decoder()
    decoder.registerReaderFactory('binary', (data: unknown) => new BinaryReader(data as Uint8Array))
    registerTypeDecoders(decoder)
    registerBinaryDecoders(decoder)

    return new ConfigurationServer(
      name,
      applicationUri,
      name,
      productUri,
      encoder,
      decoder,
      loggerFactory,
    )
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
    super(applicationName, applicationUri, productName, productUri, encoder, decoder, loggerFactory)
  }
}
