
import { getLogger, initLoggerProvider } from 'opcjs-base'
import type { ILogger } from 'opcjs-base'

import type { IAddressSpace } from './addressSpace/iAddressSpace.js'
import { AddressSpace } from './addressSpace/addressSpace.js'
import { ConfigurationServer, type ServerOptions } from './configuration/configurationServer.js'
import { AttributeService } from './services/attributeService.js'
import { DiscoveryService } from './services/discoveryService.js'
import { MonitoredItemService } from './services/monitoredItemService.js'
import { ServiceDispatcher } from './services/serviceDispatcher.js'
import { SessionService } from './services/sessionService.js'
import { SubscriptionService } from './services/subscriptionService.js'
import { ViewService } from './services/viewService.js'
import { SessionManager } from './sessions/sessionManager.js'
import { SubscriptionManager } from './subscription/subscriptionManager.js'
import { ConnectionHandler } from './transport/connectionHandler.js'
import { WebSocketListener } from './transport/webSocketListener.js'

/**
 * Entry point for an OPC UA server.
 *
 * Accepts a {@link ConfigurationServer} for full control, or a plain
 * {@link ServerOptions} bag which is converted via
 * {@link ConfigurationServer.fromOptions}.
 *
 * Uses WebSocket transport with SecurityPolicy None and anonymous
 * authentication.  Start with {@link start} and stop cleanly with {@link stop}.
 *
 * The address space can be replaced before calling {@link start} by assigning
 * to the {@link addressSpace} property.  Defaults to {@link AddressSpace}
 * which pre-populates the four standard OPC UA server nodes.
 */
export class OpcUaServer {
  private readonly config: ConfigurationServer
  private readonly logger: ILogger
  private running = false
  private listener?: WebSocketListener
  private sessionManager?: SessionManager
  private subscriptionManager?: SubscriptionManager

  /** Address space used by the Attribute service. Replace before {@link start}. */
  public addressSpace: IAddressSpace = new AddressSpace()

  constructor(optionsOrConfig: ServerOptions | ConfigurationServer) {
    this.config =
      optionsOrConfig instanceof ConfigurationServer
        ? optionsOrConfig
        : ConfigurationServer.fromOptions(optionsOrConfig)

    initLoggerProvider(this.config.loggerFactory)
    this.logger = getLogger('OpcUaServer')
  }

  /** Whether the server is currently running. */
  get isRunning(): boolean {
    return this.running
  }

  /** Application URI from the configuration. */
  get applicationUri(): string {
    return this.config.applicationUri
  }

  /** The OPC UA endpoint URL (available after {@link start} completes). */
  get endpointUrl(): string {
    const cfg = this.config
    const port = this.listener?.boundPort ?? cfg.port
    return `opc.wss://${cfg.hostname}:${port}${cfg.endpointPath}`
  }

  /** Starts the server. Resolves when the listener is bound and ready. */
  async start(): Promise<void> {
    if (this.running) {
      return
    }
    this.logger.info(
      `Starting OPC UA server "${this.config.productName}" (${this.config.applicationUri})`,
    )

    const sessionManager = new SessionManager(this.config)
    this.sessionManager = sessionManager
    const subscriptionManager = new SubscriptionManager(this.addressSpace)
    this.subscriptionManager = subscriptionManager
    const subscriptionSvc = new SubscriptionService(subscriptionManager)
    const monitoredItemSvc = new MonitoredItemService(subscriptionManager)
    const sessionSvc = new SessionService(
      sessionManager,
      this.config,
      this.config.endpointPath,
      subscriptionManager,
    )
    const attributeSvc = new AttributeService(this.addressSpace)
    const discoverySvc = new DiscoveryService(this.config, this.config.endpointPath)
    const viewSvc = new ViewService(this.addressSpace)
    const dispatcher = new ServiceDispatcher(
      sessionManager,
      sessionSvc,
      attributeSvc,
      discoverySvc,
      subscriptionSvc,
      monitoredItemSvc,
      viewSvc,
    )

    this.listener = new WebSocketListener(this.config.port, this.config.endpointPath, ws => {
      // endpointUrl is evaluated lazily here — the listener is already bound so
      // this.listener.boundPort returns the actual OS-assigned port.
      const url = this.endpointUrl
      new ConnectionHandler(ws, url, this.config, (req, channelId) => dispatcher.dispatch(req, channelId))
    })

    await this.listener.start()

    // Re-evaluate after start() so the actual bound port is used for services.
    const url = this.endpointUrl
    sessionSvc.updateEndpointUrl(url)
    discoverySvc.updateEndpointUrl(url)

    this.running = true
    this.logger.info(`OPC UA server started at ${url}`)
  }

  /** Stops the server and releases all resources. */
  async stop(): Promise<void> {
    if (!this.running) {
      return
    }
    this.logger.info('Stopping OPC UA server')

    this.subscriptionManager?.disposeAll()
    this.subscriptionManager = undefined
    this.sessionManager?.closeAllSessions()
    this.sessionManager = undefined

    await this.listener?.stop()
    this.listener = undefined

    this.running = false
    this.logger.info('OPC UA server stopped')
  }
}

