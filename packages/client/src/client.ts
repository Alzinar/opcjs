import {
  NodeId,
  ISecureChannel,
  TcpConnectionHandler,
  SecureChannelFacade,
  SecureChannelContext,
  SecureChannelMessageEncoder,
  SecureChannelTypeDecoder,
  SecureChannelMessageDecoder,
  SecureChannelTypeEncoder,
  initLoggerProvider,
  TcpMessageInjector,
  TcpMessageDecoupler,
  getLogger,
  WebSocketFascade,
  WebSocketReadableStream,
  WebSocketWritableStream,
  SecureChannelChunkReader,
  SecureChannelChunkWriter,
  CallMethodRequest,
  Variant,
  BrowseDescription,
  BrowseDirectionEnum,
  BrowseResultMaskEnum,
  ReferenceDescription,
  LocalizedText,
  ILogger,
  ServerStateEnum,
  type ServerStatusDataType,
  type EndpointDescription,
  type ICertificateStore,
  createDefaultCertificateStore,
  type ExtensionObject,
  StatusCode,
} from 'opcjs-base'

import { SessionHandler } from './sessions/sessionHandler.js'
import { Session } from './sessions/session.js'
import { SessionInvalidError } from './sessions/sessionInvalidError.js'
import { SECURITY_POLICY_NONE_URI } from './securityConfiguration.js'
import { AttributeService } from './services/attributeService.js'
import { ReadValueResult } from './readValueResult.js'
import { SubscriptionHandler } from './subscription/subscriptionHandler.js'
import { SubscriptionService } from './services/subscriptionService.js'
import { SubscriptionOptions } from "./subscription/subscriptionOptions.js"
import { MonitoredItemService } from './services/monitoredItemService.js'
import { UserIdentity } from './userIdentity.js'
import { ConfigurationClient } from './configuration/configurationClient.js'
import { MethodService } from './services/methodService.js'
import { CallMethodResult } from './method/callMethodResult.js'
import { BrowseService } from './services/browseService.js'
import { BrowseNodeResult } from './browseNodeResult.js'
import { CallMethodArgument } from './method/callMethodArgument.js'
import type { RequestOptions } from './requestOptions.js'
import { lastAssignedHandle, nextRequestHandle } from './services/serviceBase.js'
import { NamespaceTable } from './namespaceTable.js'
import type { SelectionList } from './selectionList.js'
import { DiscoveryService } from './services/discoveryService.js'
import { isRemoteNode } from './remoteNode.js'

/** NodeId of Server_ServerStatus (ns=0, i=2256) — a cheap server-side read used for session keep-alive. */
const SERVER_STATUS_NODE_ID = NodeId.newNumeric(0, 2256)
/** NodeId of Server.NamespaceArray (ns=0, i=2255) — tracked to implement Session Client Renew NodeIds. */
const NAMESPACE_ARRAY_NODE_ID = NodeId.newNumeric(0, 2255)
/** NodeId of Server/ServerStatus/EstimatedReturnTime (ns=0, i=2992). */
const ESTIMATED_RETURN_TIME_NODE_ID = NodeId.newNumeric(0, 2992)
/** OPC UA HasProperty reference type (ns=0, i=46). Used to find property nodes. */
const HAS_PROPERTY_REF_TYPE_ID = NodeId.newNumeric(0, 46)
/**
 * OPC UA MinDateTime decoded as a JS Date timestamp (ms since Unix epoch).
 * A server that sends MinDateTime for EstimatedReturnTime does not expect to restart.
 */
const OPC_UA_MIN_DATE_TIME_MS = -11_644_473_600_000

/**
 * A spec-conformant server may reject any in-flight service request with a
 * Bad_ServerHalted/Bad_Shutdown ServiceFault once it starts shutting down (OPC UA Part 4,
 * §5.13.5). `SecureChannelFacade` surfaces a ServiceFault as a plain `Error` whose message
 * embeds the response header JSON (no typed status-code property), so this checks the
 * message text for the ServiceFault's `serviceResult`.
 */
function isServerHaltedError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false
  }
  const match = /"serviceResult":(\d+)/.exec(err.message)
  if (!match) {
    return false
  }
  const serviceResult = Number(match[1])
  return serviceResult === StatusCode.BadServerHalted || serviceResult === StatusCode.BadShutdown
}


export class Client {
  private endpointUrl: string
  private attributeService?: AttributeService
  private methodService?: MethodService
  private browseService?: BrowseService
  private session?: Session
  private subscriptionHandler?: SubscriptionHandler
  private logger: ILogger
  // Stored after connect() so that refreshSession() and disconnect() can use them.
  private secureChannel?: ISecureChannel
  private secureChannelFacade?: SecureChannelFacade
  private ws?: WebSocketFascade
  private sessionHandler?: SessionHandler
  private keepAliveTimer?: ReturnType<typeof setInterval>
  // Resolved once on first connect() ("checked on startup") and reused across reconnects;
  // see resolveCertificateStore().
  private certificateStore?: ICertificateStore
  /** Set to true while a shutdown-triggered reconnect is pending to avoid duplicate attempts. */
  private shutdownReconnectPending = false
  /** Set to true while a publish-loop-error reconnect is pending to avoid duplicate attempts. */
  private publishLoopReconnectPending = false
  /** Most recently read NamespaceArray from the server (Session Client Renew NodeIds). */
  private namespaceTable?: NamespaceTable

  /**
   * Called whenever the server's NamespaceArray changes after a session (re-)establishment
   * (OPC UA Part 4, Section 5.7.1 — Session Client Renew NodeIds conformance unit).
   *
   * Use `oldTable.remapNodeId(nodeId, newTable)` to recalculate cached NodeIds.
   *
   * @example
   * ```ts
   * client.onNamespaceTableChanged = (oldTable, newTable) => {
   *   cachedNodeId = oldTable.remapNodeId(cachedNodeId, newTable)
   * }
   * ```
   */
  onNamespaceTableChanged?: (oldTable: NamespaceTable, newTable: NamespaceTable) => void

  /**
   * Called when the server sends `EstimatedReturnTime = MinDateTime`, indicating it does not
   * expect to restart (OPC UA Part 5, Section 12.6 — Base Info Client Estimated Return Time
   * conformance unit).
   *
   * When this fires the automatic reconnect is suppressed. The application is responsible for
   * deciding whether to keep the `Client` instance or dispose it.
   *
   * @example
   * ```ts
   * client.onPermanentShutdown = () => {
   *   console.warn('Server will not restart — closing client.')
   * }
   * ```
   */
  onPermanentShutdown?: () => void

  /**
   * Called as soon as a server shutdown announcement is detected — via the keep-alive read
   * seeing `ServerStatus/State = Shutdown` or a subscription `StatusChangeNotification` with
   * `BadShutdown` / `BadServerHalted` (OPC UA Part 4, §5.13.6.2 — Session Client Detect
   * Shutdown conformance unit).
   *
   * Fires once per shutdown announcement, before `EstimatedReturnTime` is read and a
   * reconnect is scheduled. Use `onPermanentShutdown` instead to detect the specific case
   * where the server does not expect to restart.
   *
   * @example
   * ```ts
   * client.onServerShutdown = () => {
   *   console.warn('Server is shutting down; a reconnect will be attempted automatically.')
   * }
   * ```
   */
  onServerShutdown?: () => void

  getSession(): Session {
    if (!this.session) {
      throw new Error('No session available')
    }
    return this.session
  }

  /**
   * (Re-)initialises all session-scoped services from the current `this.session`.
   * Called both after the initial `connect()` and after a session refresh.
   */
  private initServices(): void {
    const authToken = this.session!.getAuthToken()
    const sc = this.secureChannel!
    this.attributeService = new AttributeService(authToken, sc)
    this.methodService = new MethodService(authToken, sc)
    this.browseService = new BrowseService(authToken, sc)

    const newSubService = new SubscriptionService(authToken, sc)
    const newMonService = new MonitoredItemService(authToken, sc)

    if (this.subscriptionHandler?.hasEntries()) {
      // Reuse the existing handler so registered callbacks, server-assigned subscription IDs,
      // and monitored-item handles are preserved across a channel reconnect.  Only replace
      // the underlying service objects that are bound to the (now-dead) old channel.
      this.subscriptionHandler.updateServices(newSubService, newMonService)
    } else {
      this.subscriptionHandler = new SubscriptionHandler(newSubService, newMonService)
    }

    // Wire callbacks on the handler (fresh or reused).
    this.subscriptionHandler.onShutdown = () => this.handleServerShutdownDetected()
    // Wire the publish-error callback so a dead publish loop triggers a reconnect.
    this.subscriptionHandler.onPublishError = () => this.handlePublishLoopError()

    // Refresh the NamespaceArray after every session (re-)establishment; fire-and-forget.
    void this.refreshNamespaceTable()
  }

  /**
   * Reads `Server.NamespaceArray` (ns=0, i=2255) and updates the stored
   * `NamespaceTable`. When the table changes compared to the previous read the
   * `onNamespaceTableChanged` callback is fired so the application can remap
   * any cached NodeIds (OPC UA Part 4, Section 5.7.1 — Session Client Renew
   * NodeIds conformance unit).
   *
   * Errors are logged as warnings and do not propagate to the caller.
   */
  private async refreshNamespaceTable(): Promise<void> {
    if (!this.attributeService) return
    try {
      const results = await this.attributeService.ReadValue([NAMESPACE_ARRAY_NODE_ID])
      // AttributeService returns DataValue.value which is a Variant; the actual
      // namespace URI array lives one level deeper inside Variant.value.
      const variant = results[0]?.value as { value?: unknown } | undefined
      const uris = variant?.value
      if (!Array.isArray(uris)) {
        this.logger.warn('NamespaceArray read returned an unexpected value; skipping table update.')
        return
      }
      const newTable = new NamespaceTable(uris as string[])
      const oldTable = this.namespaceTable
      this.namespaceTable = newTable
      if (oldTable !== undefined && !oldTable.equals(newTable)) {
        this.logger.info('NamespaceArray changed; notifying application to renew NodeIds.')
        this.onNamespaceTableChanged?.(oldTable, newTable)
      }
    } catch (err) {
      this.logger.warn('NamespaceArray read failed; namespace table not updated:', err)
    }
  }

  /**
   * Returns the most recently read `NamespaceTable` for this session.
   *
   * Available after `connect()` completes (the table is read as part of session
   * establishment). Returns `undefined` before the first successful read.
   */
  getNamespaceTable(): NamespaceTable | undefined {
    return this.namespaceTable
  }

  /**
   * Executes `fn` and, if it throws a `SessionInvalidError`, creates a fresh
   * session and retries the operation exactly once.
   *
   * This covers the reactive case: a service call reveals that the server has
   * already dropped the session (e.g. due to timeout). The new session is
   * established transparently before re-running the original operation.
   *
   * For any other error (e.g. transport-level failures when the SecureChannel
   * drops), this method attempts to reconnect the channel and reactivate the
   * existing session first — falling back to a brand-new session only when
   * reactivation fails — before retrying the operation once.
   */
  private async withSessionRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof SessionInvalidError) {
        this.logger.info(`Session invalid (${err.statusCode.toString(16)}), refreshing session...`)
        this.session = await this.sessionHandler!.createNewSession(this.identity)
        this.initServices()
        this.logger.info('Session refreshed, retrying operation.')

        // Retry once with the new session.  If it fails again the error propagates.
        return await fn()
      }

      // Possibly a channel drop: attempt reconnect + ActivateSession on existing session
      // before giving up and creating a brand-new session (OPC UA Part 4 Session Auto Reconnect).
      this.logger.info('Service call failed, attempting channel reconnect and session reactivation...')
      try {
        await this.reconnectAndReactivate()
        this.initServices()
        this.logger.info('Reconnected successfully, retrying operation.')
      } catch (reconnectErr) {
        // Reconnect itself failed; surface the original error so the caller
        // gets a meaningful diagnostic (the reconnect error is logged separately).
        this.logger.warn('Channel reconnect failed:', reconnectErr)
        throw err
      }

      // Retry once after a successful reconnect.  If it fails again the error propagates.
      return await fn()
    }
  }

  /**
   * Starts a periodic keep-alive timer that reads Server_ServerStatus when no subscription is
   * active. OPC UA Part 4, Section 5.7.1 requires clients to keep the session alive; when no
   * subscription Publish loop is running this is the only mechanism that does so.
   *
   * The keep-alive read also serves as the **Detect Shutdown** mechanism (Session Client Detect
   * Shutdown conformance unit): when the returned `ServerStatusDataType.state` equals
   * `ServerStateEnum.Shutdown` the client schedules a reconnect after
   * `SHUTDOWN_RECONNECT_DELAY_MS` to let the server finish its shutdown sequence.
   */
  private startKeepAlive(): void {
    this.keepAliveTimer = setInterval(() => {
      if (this.subscriptionHandler?.hasActiveSubscription()) {
        // The subscription publish loop is already keeping the session alive.
        return
      }
      if (this.attributeService) {
        void this.attributeService.ReadValue([SERVER_STATUS_NODE_ID]).then((results) => {
          // Navigate through the Variant/ExtensionObject wrappers: results[0].value is a
          // Variant whose .value is an ExtensionObject whose .data is the ServerStatusDataType.
          const variant = results[0]?.value as { value?: ExtensionObject } | undefined
          const statusData = variant?.value?.data as ServerStatusDataType | undefined
          if (statusData?.state === ServerStateEnum.Shutdown) {
            this.handleServerShutdownDetected()
          }
        }).catch((err) => {
          this.logger.warn('Keep-alive read failed:', err)
          // A spec-conformant server (OPC UA Part 4, §5.13.5) may reject any in-flight
          // service request — including this keep-alive read itself — with a
          // Bad_ServerHalted/Bad_Shutdown ServiceFault once it starts shutting down,
          // instead of (or in addition to) reporting Shutdown via a successful read.
          if (isServerHaltedError(err)) {
            this.handleServerShutdownDetected()
          }
        })
      }
    }, this.configuration.keepAliveIntervalMs)
  }

  private stopKeepAlive(): void {
    clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = undefined
  }

  /**
   * Called when a server-shutdown announcement is detected — either via the keep-alive read
   * returning `ServerStateEnum.Shutdown` or via a subscription `StatusChangeNotification`
   * with status `BadShutdown` / `BadServerHalted`.
   *
   * Reads `Server/ServerStatus/EstimatedReturnTime` (ns=0, i=2992) to decide how long to
   * wait before reconnecting (Base Info Client Estimated Return Time conformance unit).
   * Falls back to `configuration.shutdownReconnectDelayMs` when the read fails or the
   * attributed service is not yet available.  Fires `onPermanentShutdown` and suppresses the
   * reconnect when the server sends `MinDateTime`.
   *
   * Only one reconnect attempt is scheduled at a time; a second detection while one is already
   * pending is silently ignored — `onServerShutdown` fires only for the detection that starts
   * the pending reconnect.
   */
  private handleServerShutdownDetected(): void {
    if (this.shutdownReconnectPending) {
      return
    }
    this.shutdownReconnectPending = true
    this.stopKeepAlive()
    this.logger.warn('Server shutdown detected; reading EstimatedReturnTime...')
    this.onServerShutdown?.()
    void this.computeReconnectDelayMs().then((delayMs) => {
      if (delayMs === null) {
        this.logger.warn(
          'Server indicated it will not restart (MinDateTime). Firing onPermanentShutdown.',
        )
        this.onPermanentShutdown?.()
        this.shutdownReconnectPending = false
        return
      }
      this.logger.warn(`Scheduling reconnect in ${delayMs} ms...`)
      setTimeout(() => {
        void this.reconnectAndReactivate()
          .then(() => {
            this.initServices()
            this.startKeepAlive()
            this.logger.info('Reconnected after server shutdown.')
          })
          .catch((err) => {
            this.logger.warn('Reconnect after server shutdown failed:', err)
          })
          .finally(() => {
            this.shutdownReconnectPending = false
          })
      }, delayMs)
    })
  }

  /**
   * Called when the subscription publish loop terminates due to a transport or service error
   * (e.g. `Bad_NoCommunication`).  The loop has already stopped; this method reconnects the
   * channel, reinitialises services (preserving the existing subscription entries), and
   * restarts the loop so notifications resume transparently.
   *
   * Only one reconnect attempt is scheduled at a time; duplicate firings are ignored.
   */
  private handlePublishLoopError(): void {
    if (this.publishLoopReconnectPending) {
      return
    }
    this.publishLoopReconnectPending = true
    this.stopKeepAlive()
    this.logger.warn('Publish loop error — attempting to reconnect and restart publish loop...')
    void this.reconnectAndReactivate()
      .then(() => {
        this.initServices()
        // initServices() preserves entries and updates service references.
        // Restart the loop so notifications resume on the re-established channel.
        this.subscriptionHandler?.restartPublishLoop()
        this.startKeepAlive()
        this.logger.info('Reconnected after publish loop error; publish loop restarted.')
      })
      .catch((err) => {
        this.logger.warn('Reconnect after publish loop error failed:', err)
      })
      .finally(() => {
        this.publishLoopReconnectPending = false
      })
  }

  /**
   * Reads `Server/ServerStatus/EstimatedReturnTime` (ns=0, i=2992) and returns the reconnect
   * delay in milliseconds (Base Info Client Estimated Return Time — OPC UA Part 5, §12.6):
   *
   * - Valid future `DateTime` → delay = `estimatedReturnTime − now`, clamped to at least
   *   `MIN_RECONNECT_DELAY_MS`.
   * - Past `DateTime` (server should already be available) → `MIN_RECONNECT_DELAY_MS`.
   * - OPC UA `MinDateTime` (server will not restart) → `null`.
   * - Unreadable / unavailable → falls back to `configuration.shutdownReconnectDelayMs`.
   */
  private async computeReconnectDelayMs(): Promise<number | null> {
    if (!this.attributeService) {
      return this.configuration.shutdownReconnectDelayMs
    }
    try {
      const results = await this.attributeService.ReadValue([ESTIMATED_RETURN_TIME_NODE_ID])
      // Navigate through the Variant wrapper: results[0].value is a Variant whose .value is the Date.
      const variant = results[0]?.value as { value?: unknown } | undefined
      const estimatedReturnTime = variant?.value
      if (estimatedReturnTime instanceof Date && !isNaN(estimatedReturnTime.getTime())) {
        if (estimatedReturnTime.getTime() <= OPC_UA_MIN_DATE_TIME_MS) {
          // MinDateTime: server will not restart.
          return null
        }
        const delayMs = estimatedReturnTime.getTime() - Date.now()
        if (delayMs > 0) {
          this.logger.info(
            `EstimatedReturnTime: ${estimatedReturnTime.toISOString()} (reconnect in ${delayMs} ms).`,
          )
          return delayMs
        }
        // EstimatedReturnTime is already in the past — server should be back, retry quickly.
        this.logger.info('EstimatedReturnTime is in the past; reconnecting immediately.')
        return this.configuration.minReconnectDelayMs
      }
    } catch (err) {
      this.logger.debug('Failed to read EstimatedReturnTime; using configured delay:', err)
    }
    return this.configuration.shutdownReconnectDelayMs
  }

  /**
   * Retrieves the EndpointDescriptions supported by this client's configured
   * `endpointUrl` (OPC UA Part 4, Section 5.4.4 — GetEndpoints Service).
   *
   * Implements the Discovery Client Configure Endpoint conformance unit: the caller
   * can inspect the returned SecurityPolicy / MessageSecurityMode combinations and
   * pick one to pass to `connect()` (as an `EndpointDescription`) instead of relying
   * on the endpoint automatically selected during `CreateSession`.
   *
   * Opens and closes a temporary SecureChannel — no Session is created and any
   * existing session/channel on this `Client` instance is left untouched.
   *
   * @example
   * ```ts
   * const endpoints = await client.getEndpoints()
   * const chosen = endpoints.find(e => e.securityPolicyUri?.endsWith('#None'))
   * await client.connect(chosen)
   * ```
   */
  async getEndpoints(): Promise<EndpointDescription[]> {
    const { ws, sc } = await this.openTransportAndChannel()
    try {
      const discoveryService = new DiscoveryService(sc)
      return await discoveryService.getEndpoints(this.endpointUrl)
    } finally {
      sc.close()
      ws.close()
    }
  }

  /**
   * Connects to the OPC UA server and establishes a Session.
   *
   * @param endpoint - Optional pre-selected `EndpointDescription` (e.g. obtained from
   *   `getEndpoints()` or a configuration file). When provided, its `endpointUrl` is
   *   used to open the SecureChannel, bypassing an internal `GetEndpoints` round-trip
   *   (Discovery Client Configure Endpoint conformance unit — OPC UA Part 4, §5.4.3).
   *   When omitted, the `endpointUrl` passed to the `Client` constructor is used, as before.
   */
  async connect(endpoint?: EndpointDescription): Promise<void> {
    if (endpoint?.endpointUrl) {
      this.endpointUrl = endpoint.endpointUrl
    }

    const { ws, sc } = await this.openTransportAndChannel()

    this.secureChannel = sc
    this.secureChannelFacade = sc
    this.ws = ws

    const certificateStore = await this.resolveCertificateStore()

    this.logger.debug('Creating session...')
    this.sessionHandler = new SessionHandler(sc, this.configuration, certificateStore)
    this.session = await this.sessionHandler.createNewSession(this.identity)
    this.logger.debug('Session created.')

    this.logger.debug('Initializing services...')
    this.initServices()
    this.startKeepAlive()
  }

  /**
   * Resolves the `ICertificateStore` to use (Security Admin – Certificate Management):
   * the one configured in `securityConfiguration.certificateStore`, or a default created
   * for the current environment (Node vs browser) on first use and cached for the
   * lifetime of this `Client` instance.
   *
   * Called once at startup (`connect()`) rather than lazily inside `SessionHandler`, so
   * store-creation failures (e.g. PKI directory permission errors) surface immediately.
   */
  private async resolveCertificateStore(): Promise<ICertificateStore> {
    const configured = this.configuration.securityConfiguration?.certificateStore
    if (configured) return configured

    if (!this.certificateStore) {
      this.certificateStore = await createDefaultCertificateStore()
      await this.ensureDefaultOwnCertificate(this.certificateStore)
    }
    return this.certificateStore
  }

  /**
   * Security Default ApplicationInstance Certificate (OPC 10000-6 §6.2): ensures the
   * default certificate store always holds a valid own `ApplicationInstanceCertificate`,
   * generating a self-signed one on first use when none exists yet — so every deployed
   * instance has a unique certificate identity without requiring manual installation steps.
   *
   * Only applied to the client's own default store (Node `FileSystemCertificateStore` /
   * browser `IndexedDbCertificateStore`); a caller-supplied `securityConfiguration.certificateStore`
   * is assumed to already be provisioned by its owner.
   */
  private async ensureDefaultOwnCertificate(store: ICertificateStore): Promise<void> {
    if (await store.getOwn()) return
    this.logger.info('No ApplicationInstanceCertificate found in the default certificate store; generating one.')
    await store.generateOwn({
      applicationUri: this.configuration.applicationUri,
      commonName: this.configuration.applicationName,
    })
  }

  /**
   * Builds the full WebSocket → TCP → SecureChannel pipeline and returns the
   * two objects needed to drive it: the raw WebSocket facade (for teardown)
   * and the SecureChannelFacade (for service requests/session management).
   *
   * Extracted from `connect()` so it can be reused by `reconnectAndReactivate()`.
   */
  private async openTransportAndChannel(): Promise<{ ws: WebSocketFascade; sc: SecureChannelFacade }> {
    const wsOptions = { endpoint: this.endpointUrl }
    const ws = new WebSocketFascade(wsOptions);
    const webSocketReadableStream = new WebSocketReadableStream(ws, 1000);
    const webSocketWritableStream = new WebSocketWritableStream(ws);

    const scContext = new SecureChannelContext(this.endpointUrl);
    const tcpMessageInjector = new TcpMessageInjector();
    const tcpConnectionHandler = new TcpConnectionHandler(tcpMessageInjector, scContext);
    const tcpMessageDecoupler = new TcpMessageDecoupler(tcpConnectionHandler.onTcpMessage.bind(tcpConnectionHandler));
    const scMessageEncoder = new SecureChannelMessageEncoder(scContext);
    const scTypeDecoder = new SecureChannelTypeDecoder(
      this.configuration.decoder,
    );
    const scMessageDecoder = new SecureChannelMessageDecoder(scContext);
    const scTypeEncoder = new SecureChannelTypeEncoder(
      this.configuration.encoder,
    );
    const scChunkWriter = new SecureChannelChunkWriter(scContext);
    const scChunkReader = new SecureChannelChunkReader(scContext);

    webSocketReadableStream.pipeTo(tcpMessageDecoupler.writable);
    tcpMessageDecoupler.readable.pipeTo(scMessageDecoder.writable);
    scMessageDecoder.readable.pipeTo(scChunkReader.writable);
    scChunkReader.readable.pipeTo(scTypeDecoder.writable);

    scTypeEncoder.readable.pipeTo(scChunkWriter.writable);
    scChunkWriter.readable.pipeTo(scMessageEncoder.writable);
    scMessageEncoder.readable.pipeTo(tcpMessageInjector.writable);
    tcpMessageInjector.readable.pipeTo(webSocketWritableStream);

    const sc = new SecureChannelFacade(scContext, scTypeDecoder, scTypeEncoder);

    let connected = false;
    while (!connected) {
      this.logger.debug(`Connecting to OPC UA server at ${this.endpointUrl}...`);
      await ws.connect();
      this.logger.debug("WebSocket connection established, now establishing TCP connection...");
      connected = await tcpConnectionHandler.connect(this.endpointUrl);

      if (!connected) {
        this.logger.info("Connection failed, retrying in 2 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    this.logger.info("Connected to OPC UA server.");

    this.logger.debug("Opening secure channel...");
    await sc.openSecureChannel();
    this.logger.debug("Secure channel established.");

    // Enforce any channel-level security requirements before proceeding.
    this.enforceChannelSecurityConfig(sc);

    return { ws, sc };
  }

  /**
   * Validates the negotiated channel's security policy and mode against the
   * client's `SecurityConfiguration` (OPC UA Part 2, Security Administration).
   *
   * Throws if:
   * - `allowSecurityPolicyNone` is `false` and the channel uses SecurityPolicy None.
   * - `messageSecurityMode` is set and does not match the channel's actual mode.
   */
  private enforceChannelSecurityConfig(sc: SecureChannelFacade): void {
    const config = this.configuration.securityConfiguration
    if (!config) return

    const negotiatedPolicy = sc.getSecurityPolicy()
    const negotiatedMode = sc.getSecurityMode()

    if (config.allowSecurityPolicyNone === false && negotiatedPolicy === SECURITY_POLICY_NONE_URI) {
      throw new Error(
        'Connection refused: SecurityPolicy None is disabled by the client security configuration. ' +
        'Only SecurityPolicy None is currently supported by this client implementation.',
      )
    }

    if (config.messageSecurityMode !== undefined && config.messageSecurityMode !== negotiatedMode) {
      throw new Error(
        `Connection refused: negotiated MessageSecurityMode ${negotiatedMode} does not match ` +
        `the required mode ${config.messageSecurityMode} from the security configuration.`,
      )
    }
  }

  /**
   * Tears down the current (dead) channel and establishes a fresh one, then
   * attempts to recover the existing OPC UA session via ActivateSession before
   * falling back to a full CreateSession + ActivateSession.
   *
   * OPC UA Part 4, Section 5.7.1 / Session Client Auto Reconnect conformance unit:
   * When the SecureChannel drops but the server-side session has not yet timed
   * out, the client SHOULD reuse the existing session by calling ActivateSession
   * on the new channel.  Only if that fails should the client create a new session.
   */
  private async reconnectAndReactivate(): Promise<void> {
    this.logger.info('Tearing down dead channel before reconnect...')

    // Close the old channel and WebSocket (best effort — they may already be dead).
    try { this.secureChannelFacade?.close() } catch { /* already dead */ }
    try { this.ws?.close() } catch { /* already dead */ }
    this.secureChannelFacade = undefined
    this.secureChannel = undefined
    this.ws = undefined

    const { ws, sc } = await this.openTransportAndChannel()
    this.secureChannel = sc
    this.secureChannelFacade = sc
    this.ws = ws
    this.sessionHandler = new SessionHandler(sc, this.configuration, await this.resolveCertificateStore())

    // Attempt to reactivate the existing session on the new channel.
    if (this.session) {
      const reactivated = await this.sessionHandler.tryActivateExistingSession(
        this.session.getAuthToken(),
        this.session.getSessionId(),
        this.session.getEndpoint(),
        this.identity,
      )
      if (reactivated !== null) {
        this.session = reactivated
        this.logger.info('Existing session successfully reactivated on new channel.')
        return
      }
      this.logger.info('ActivateSession for existing session failed; creating a fresh session...')
    }

    // Fall back: full CreateSession + ActivateSession.
    this.session = await this.sessionHandler.createNewSession(this.identity)
    this.logger.info('Fresh session established on new channel.')
  }

  /**
   * Gracefully disconnects from the OPC UA server.
   *
   * Sequence per OPC UA Part 4, Section 5.7.4:
   * 1. CloseSession (deleteSubscriptions=true) so the server frees all resources.
   * 2. Close the SecureChannel, which cancels the pending token-renewal timer.
   * 3. Close the WebSocket transport.
   *
   * CloseSession errors are swallowed so transport teardown always completes even
   * when the session has already expired on the server side.
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from OPC UA server...')
    this.stopKeepAlive()
    // Detach reconnect callbacks before tearing down the channel below: closing it
    // rejects any in-flight Publish request, which would otherwise trigger an
    // unwanted auto-reconnect right after an intentional disconnect.
    this.subscriptionHandler?.stop()

    if (this.session && this.sessionHandler) {
      try {
        await this.sessionHandler.closeSession(true)
      } catch (err) {
        // Session may already be gone on the server; log and continue teardown.
        this.logger.warn('CloseSession failed (continuing teardown):', err)
      }
      this.session = undefined
    }

    this.secureChannelFacade?.close()
    this.secureChannelFacade = undefined
    this.secureChannel = undefined

    this.ws?.close()
    this.ws = undefined

    this.logger.info('Disconnected.')
  }

  /**
   * Reads the Value attribute of one or more Nodes.
   *
   * The returned object is a `Promise` that also exposes `requestHandle` — the
   * OPC UA `requestHandle` assigned to the underlying `ReadRequest`.  The handle
   * is available synchronously (before `await`) so it can be passed to
   * `cancel()` to abort the in-flight request.
   *
   * @example
   * ```ts
   * const req = client.read([nodeId])
   * await client.cancel(req.requestHandle) // abort before response
   * const results = await req              // ReadValueResult[]
   * ```
   */
  read(ids: NodeId[], options?: RequestOptions): Promise<ReadValueResult[]> & { requestHandle: number } {
    const requestHandle = nextRequestHandle()
    const promise = this.withSessionRefresh(async () => {
      const result = await this.attributeService?.ReadValue(ids, 0, undefined, options?.returnDiagnostics, requestHandle)
      return result?.map(r => new ReadValueResult(r.value, r.statusCode, r.diagnosticInfo)) ?? []
    })
    return Object.assign(promise, { requestHandle })
  }

  /**
   * Method for calling a single method on the server.
   *
   * The returned object is a `Promise` that also exposes `requestHandle` — the
   * OPC UA `requestHandle` assigned to the underlying `CallRequest`. The handle
   * is available synchronously (before `await`) so it can be passed to
   * `cancel()` to abort the in-flight request.
   *
   * @param objectId - NodeId of the Object that owns the method.
   * @param methodId - NodeId of the Method to invoke.
   * @param inputArguments - Input argument Variants (default: empty).
   * @param options - Request options (e.g. `returnDiagnostics`).
   * @returns A promise resolving to the CallMethodResult, with `requestHandle` available synchronously.
   */
  callMethod(
    objectId: NodeId,
    methodId: NodeId,
    inputArguments: CallMethodArgument[] = [],
    options?: RequestOptions,
  ): Promise<CallMethodResult> & { requestHandle: number } {
    const requestHandle = nextRequestHandle()
    const promise = this.withSessionRefresh(async () => {
      const request = new CallMethodRequest()
      request.objectId = objectId
      request.methodId = methodId
      request.inputArguments = inputArguments.map(arg => Variant.newFrom(arg as Parameters<typeof Variant.newFrom>[0]))

      const responses = await this.methodService!.call([request], options?.returnDiagnostics, requestHandle)
      const response = responses[0]
      return new CallMethodResult(response.value, response.statusCode, response.diagnosticInfo)
    })
    return Object.assign(promise, { requestHandle })
  }

  /**
   * Browses the Address Space starting from `nodeId`.
   *
   * The returned object is a `Promise` that also exposes `requestHandle` — the
   * OPC UA `requestHandle` assigned to the initial `BrowseRequest`. The handle
   * is available synchronously (before `await`) so it can be passed to
   * `cancel()` to abort the in-flight request.
   *
   * @param nodeId - Starting node.
   * @param recursive - When true, recursively follows HierarchicalReferences.
   * @param options - Request options (e.g. `returnDiagnostics`).
   * @returns A promise resolving to the list of referenced nodes, with `requestHandle` available synchronously.
   */
  browse(
    nodeId: NodeId,
    recursive: boolean = false,
    options?: RequestOptions,
  ): Promise<BrowseNodeResult[]> & { requestHandle: number } {
    const requestHandle = nextRequestHandle()
    const promise = this.withSessionRefresh(() => {
      const visited = new Set<string>()
      return this.browseRecursive(nodeId, recursive, visited, options?.returnDiagnostics ?? 0, requestHandle)
    })
    return Object.assign(promise, { requestHandle })
  }

  private async browseRecursive(
    nodeId: NodeId,
    recursive: boolean,
    visited: Set<string>,
    returnDiagnostics: number,
    requestHandle?: number,
  ): Promise<BrowseNodeResult[]> {
    const nodeKey = `${nodeId.namespace}:${nodeId.identifier}`;
    if (visited.has(nodeKey)) {
      return [];
    }
    visited.add(nodeKey);

    const description = new BrowseDescription();
    description.nodeId = nodeId;
    description.browseDirection = BrowseDirectionEnum.Forward;
    description.referenceTypeId = NodeId.newNumeric(0, 33); // HierarchicalReferences
    description.includeSubtypes = true;
    description.nodeClassMask = 0; // all node classes
    description.resultMask = BrowseResultMaskEnum.All;

    const browseResults = await this.browseService!.browse([description], returnDiagnostics, requestHandle);
    const browseResult = browseResults[0];
    const allReferences = [...(browseResult.references ?? [])];

    let continuationPoint = browseResult.continuationPoint;
    while (continuationPoint && continuationPoint.byteLength > 0) {
      const nextResults = await this.browseService!
        .browseNext([continuationPoint], false, returnDiagnostics);
      const nextResult = nextResults[0];
      allReferences.push(...(nextResult.references ?? []));
      continuationPoint = nextResult.continuationPoint;
    }

    const results = allReferences.map((ref: ReferenceDescription) =>
      new BrowseNodeResult(
        ref.referenceTypeId,
        ref.isForward,
        ref.nodeId,
        ref.browseName,
        ref.displayName,
        ref.nodeClass,
        ref.typeDefinition,
      )
    );

    if (recursive) {
      for (const ref of allReferences) {
        if (isRemoteNode(ref.nodeId)) {
          // Base Info Client Remote Nodes: this client has no multi-server registry and
          // cannot browse a Node belonging to another server. Skip it rather than
          // constructing a NodeId that silently drops the serverIndex/namespaceUri.
          this.logger.debug(
            `Skipping recursive browse of remote node ${ref.nodeId.toString()}; ` +
            'pre-configure a separate Client for the target server to access it.',
          )
          continue
        }
        const childNodeId = NodeId.newNumeric(
          ref.nodeId.nodeId.namespace,
          ref.nodeId.nodeId.identifier as number,
        );
        const childResults = await this.browseRecursive(
          childNodeId, true, visited, returnDiagnostics,
        );
        results.push(...childResults);
      }
    }

    return results;
  }

  /**
   * Creates a Subscription and MonitoredItems for `ids` (OPC UA Part 4, §5.13).
   *
   * Can be called multiple times on the same session to create independent
   * Subscriptions, each with its own `publishingInterval`/`priority` (Subscription
   * Client Multiple conformance unit). All Subscriptions on a session share a single
   * Publish pipeline (Publish is a per-Session service, not per-Subscription).
   *
   * @returns The server-assigned `subscriptionId` for the newly created Subscription.
   */
  async subscribe(
    ids: NodeId[],
    callback: (data: { id: NodeId; value: unknown }[]) => void,
    options?: SubscriptionOptions
  ): Promise<number> {
    if (!this.subscriptionHandler) {
      throw new Error('Not connected: call connect() before subscribe()')
    }
    return this.subscriptionHandler.subscribe(ids, callback, options);
  }

  /**
   * Asks the server to cancel a pending service request
   * (OPC UA Part 4, Section 5.7.5 — Session Client Cancel conformance unit).
   *
   * The `requestHandle` uniquely identifies the pending request. It is the value
   * assigned to `RequestHeader.requestHandle` when the request was initially sent.
   * Service calls made through this client automatically assign monotonically
   * increasing handles, so the caller can capture the handle before or after issuing
   * Each method (`read`, `browse`, `callMethod`) returns a `Promise` with a
   * `requestHandle` property that is available synchronously.  Pass that handle
   * here to abort the corresponding in-flight request.
   *
   * The server makes a best-effort attempt to cancel the matching request. Cancelled
   * requests complete with status `BadRequestCancelledByClient`. Not all servers
   * guarantee that a request in flight can be cancelled.
   *
   * @param requestHandle - Handle of the pending request to cancel.
   * @returns The number of pending requests the server actually cancelled.
   * @throws If no session is active or the server returns a non-Good status.
   *
   * @example
   * ```ts
   * // Issue a potentially slow operation and immediately cancel it.
   * const req = client.read([nodeId])
   * const cancelled = await client.cancel(req.requestHandle)
   * console.log(`Cancelled ${cancelled} request(s)`)
   * const results = await req  // resolves with BadRequestCancelledByClient
   * ```
   */
  async cancel(requestHandle: number): Promise<number> {
    if (!this.sessionHandler) {
      throw new Error('Not connected: call connect() before cancel()')
    }
    return this.sessionHandler.cancel(requestHandle)
  }

  /**
   * Switches the active user identity for the current session by calling ActivateSession
   * with a new identity token (OPC UA Part 4, Section 5.7.3 — Session Client Impersonate
   * conformance unit).
   *
   * The server re-evaluates authorisation under the new identity while keeping all existing
   * Subscriptions and MonitoredItems intact. The new identity is also stored so that any
   * subsequent auto-reconnect or session refresh uses it instead of the original identity.
   *
   * @param identity - The new user identity to apply to the session.
   * @throws {Error} When not connected (call `connect()` first).
   * @throws {Error} When the server rejects the identity (e.g. `BadIdentityTokenRejected`
   *   or `BadUserAccessDenied`).
   *
   * @example
   * ```ts
   * await client.connect()
   * // ... work as the original user ...
   * await client.impersonate(UserIdentity.newWithUserName('admin', 'secret'))
   * // ... subsequent calls run under the admin identity ...
   * ```
   */
  async impersonate(identity: UserIdentity): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected: call connect() before impersonate()')
    }
    await this.session.impersonate(identity)
    // Store the new identity so that reconnect / session refresh uses it.
    this.identity = identity
  }

  /**
   * Reads the `SelectionListType` metadata for a Variable
   * (OPC UA Part 5, §7.18 — Base Info Client Selection List conformance unit).
   *
   * The client browses the node's `HasProperty` references for `Selections`,
   * `SelectionDescriptions`, and `RestrictToList`, then reads their values in a
   * single batch Read request.
   *
   * Works transparently for instances of `SelectionListType` (ns=0; i=19726) and
   * any of its subtypes, because all subtypes inherit the `Selections` mandatory
   * property.
   *
   * @param nodeId - NodeId of the Variable to inspect.
   * @returns `SelectionList` when the node has a `Selections` property, `null` otherwise.
   * @throws When not connected or if the server returns a non-Good service status.
   *
   * @example
   * ```ts
   * const list = await client.getSelectionList(nodeId)
   * if (list) {
   *   list.selectionDescriptions.forEach((desc, i) =>
   *     console.log(`[${i}] ${desc.text}:`, list.selections[i])
   *   )
   * }
   * ```
   */
  getSelectionList(nodeId: NodeId): Promise<SelectionList | null> {
    return this.withSessionRefresh(() => this.fetchSelectionList(nodeId))
  }

  /**
   * Internal implementation of `getSelectionList`. Browses the node's
   * HasProperty references to locate Selections/SelectionDescriptions/RestrictToList,
   * then batch-reads their values.
   */
  private async fetchSelectionList(nodeId: NodeId): Promise<SelectionList | null> {
    if (!this.browseService || !this.attributeService) {
      throw new Error('Not connected: call connect() before getSelectionList()')
    }

    // Browse forward HasProperty (i=46) references to find the property nodes.
    // SelectionListType mandates a Selections property; subtypes inherit it.
    const description = new BrowseDescription()
    description.nodeId = nodeId
    description.browseDirection = BrowseDirectionEnum.Forward
    description.referenceTypeId = HAS_PROPERTY_REF_TYPE_ID
    description.includeSubtypes = false
    description.nodeClassMask = 0
    description.resultMask = BrowseResultMaskEnum.All

    const browseResults = await this.browseService.browse([description])
    const refs = browseResults[0]?.references ?? []

    let selectionsNodeId: NodeId | undefined
    let selectionsDescNodeId: NodeId | undefined
    let restrictToListNodeId: NodeId | undefined

    for (const ref of refs) {
      const name = ref.browseName?.name
      if (name === 'Selections') {
        selectionsNodeId = ref.nodeId.nodeId
      } else if (name === 'SelectionDescriptions') {
        selectionsDescNodeId = ref.nodeId.nodeId
      } else if (name === 'RestrictToList') {
        restrictToListNodeId = ref.nodeId.nodeId
      }
    }

    // Selections is mandatory on SelectionListType; if absent, this is not a SelectionListType variable.
    if (!selectionsNodeId) {
      return null
    }

    // Batch-read all found property nodes in a single request.
    const nodeIdsToRead: NodeId[] = [selectionsNodeId]
    if (selectionsDescNodeId) nodeIdsToRead.push(selectionsDescNodeId)
    if (restrictToListNodeId) nodeIdsToRead.push(restrictToListNodeId)

    const readResults = await this.attributeService.ReadValue(nodeIdsToRead)

    // Navigate the Variant wrapper: ReadValue returns DataValue.value which is a Variant;
    // the actual property value lives one level deeper in Variant.value.
    const selectionsVariant = readResults[0]?.value as { value?: unknown } | undefined
    const selections: unknown[] = Array.isArray(selectionsVariant?.value)
      ? (selectionsVariant.value as unknown[])
      : []

    let selectionDescriptions: LocalizedText[] = []
    let descReadIdx = 1
    if (selectionsDescNodeId) {
      const descVariant = readResults[descReadIdx]?.value as { value?: unknown } | undefined
      if (Array.isArray(descVariant?.value)) {
        selectionDescriptions = descVariant.value as LocalizedText[]
      }
      descReadIdx++
    }

    let restrictToList = false
    if (restrictToListNodeId) {
      const rtlVariant = readResults[descReadIdx]?.value as { value?: unknown } | undefined
      if (typeof rtlVariant?.value === 'boolean') {
        restrictToList = rtlVariant.value
      }
    }

    return { nodeId, selections, selectionDescriptions, restrictToList }
  }

  /**
   * The `requestHandle` value that was assigned to the most recently issued
   * service request in this session.
   *
   * @deprecated Prefer accessing `requestHandle` directly on the promise returned
   *   by `read()`, `browse()`, or `callMethod()`, which is available synchronously
   *   before `await` and avoids relying on shared module state.
   *
   * Returns `0` before any request has been sent.
   */
  get lastRequestHandle(): number {
    return lastAssignedHandle()
  }

  constructor(
    endpointUrl: string,
    private configuration: ConfigurationClient,
    private identity: UserIdentity,
  ) {
    this.endpointUrl = endpointUrl;
    initLoggerProvider(configuration.loggerFactory);
    this.logger = getLogger("Client");
  }
}
