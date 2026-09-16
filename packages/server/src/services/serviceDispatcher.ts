import {
  ActivateSessionRequest,
  BrowseNextRequest,
  BrowseRequest,
  CloseSessionRequest,
  CreateMonitoredItemsRequest,
  CreateSessionRequest,
  CreateSubscriptionRequest,
  DeleteMonitoredItemsRequest,
  DeleteSubscriptionsRequest,
  DiagnosticInfo,
  ExtensionObject,
  FindServersRequest,
  GetEndpointsRequest,
  ModifyMonitoredItemsRequest,
  ModifySubscriptionRequest,
  NodeId,
  PublishRequest,
  ReadRequest,
  RegisterNodesRequest,
  RepublishRequest,
  ResponseHeader,
  ServiceFault,
  SetMonitoringModeRequest,
  SetPublishingModeRequest,
  StatusCode,
  TranslateBrowsePathsToNodeIdsRequest,
  UnregisterNodesRequest,
  WriteRequest,
  getLogger,
} from 'opcjs-base'
import type { IOpcType, ILogger } from 'opcjs-base'

import { SessionError } from '../sessions/sessionManager.js'
import type { SessionManager } from '../sessions/sessionManager.js'
import type { AttributeService } from './attributeService.js'
import type { DiscoveryService } from './discoveryService.js'
import type { MonitoredItemService } from './monitoredItemService.js'
import type { SessionService } from './sessionService.js'
import type { SubscriptionService } from './subscriptionService.js'
import type { ViewService } from './viewService.js'

/**
 * Routes decoded OPC UA service requests to the appropriate handler.
 *
 * Enforces the Session General Service Behaviour (OPC UA Part 4 §5.6.1):
 * - `GetEndpoints`, `FindServers` and `CreateSession` require no session.
 * - `ActivateSession` requires the session to *exist* but not yet be active.
 * - All other services validate a fully activated session before dispatching.
 *
 * On session errors a `ServiceFault` is returned in-band so the transport
 * always receives a valid encodable response.
 *
 * @see OPC UA Part 4 §5.2 & §5.6.1
 */
export class ServiceDispatcher {
  private readonly logger: ILogger

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionSvc: SessionService,
    private readonly attributeSvc: AttributeService,
    private readonly discoverySvc: DiscoveryService,
    private readonly subscriptionSvc: SubscriptionService,
    private readonly monitoredItemSvc: MonitoredItemService,
    private readonly viewSvc: ViewService,
  ) {
    this.logger = getLogger('services.ServiceDispatcher')
  }

  /**
   * Dispatches `request` to the correct service handler.
   *
   * @param request - Fully-decoded OPC UA request object
   * @param channelId - Secure-channel ID the request arrived on
   */
  async dispatch(request: IOpcType, channelId: number): Promise<IOpcType> {
    // Session-less discovery and session-creation paths.
    if (request instanceof GetEndpointsRequest) {
      return this.discoverySvc.getEndpoints(request)
    }
    if (request instanceof FindServersRequest) {
      return this.discoverySvc.findServers(request)
    }
    if (request instanceof CreateSessionRequest) {
      return this.sessionSvc.createSession(request, channelId)
    }
    // ActivateSession: session must exist but need not be activated yet.
    if (request instanceof ActivateSessionRequest) {
      return this.sessionSvc.activateSession(request, channelId)
    }

    // All remaining services require a valid, activated session.
    const authToken = extractAuthToken(request)
    if (authToken == null) {
      this.logger.warn(`${request.constructor.name}: missing authenticationToken`)
      return makeServiceFault(0, StatusCode.BadSessionIdInvalid)
    }

    try {
      this.sessionManager.validateSession(authToken)
    } catch (err) {
      if (err instanceof SessionError) {
        return makeServiceFault(extractRequestHandle(request), err.statusCode)
      }
      throw err
    }

    this.sessionManager.touchSession(authToken)

    if (isRequestStale(request)) {
      return makeServiceFault(extractRequestHandle(request), StatusCode.BadTimeout)
    }

    if (request instanceof CloseSessionRequest) {
      return this.sessionSvc.closeSession(request)
    }
    if (request instanceof ReadRequest) {
      // Session is guaranteed valid after validateSession above.
      const session = this.sessionManager.validateSession(authToken)
      return this.attributeSvc.read(request, session)
    }
    if (request instanceof WriteRequest) {
      const session = this.sessionManager.validateSession(authToken)
      return this.attributeSvc.write(request, session)
    }
    if (request instanceof BrowseRequest) {
      const session = this.sessionManager.validateSession(authToken)
      return this.viewSvc.browse(request, session)
    }
    if (request instanceof BrowseNextRequest) {
      const session = this.sessionManager.validateSession(authToken)
      return this.viewSvc.browseNext(request, session)
    }
    if (request instanceof TranslateBrowsePathsToNodeIdsRequest) {
      return this.viewSvc.translateBrowsePathsToNodeIds(request)
    }
    if (request instanceof RegisterNodesRequest) {
      const session = this.sessionManager.validateSession(authToken)
      return this.viewSvc.registerNodes(request, session)
    }
    if (request instanceof UnregisterNodesRequest) {
      const session = this.sessionManager.validateSession(authToken)
      return this.viewSvc.unregisterNodes(request, session)
    }
    if (request instanceof CreateSubscriptionRequest) {
      const session = this.sessionManager.validateSession(authToken)
      return this.subscriptionSvc.createSubscription(request, session)
    }
    if (request instanceof ModifySubscriptionRequest) {
      return this.subscriptionSvc.modifySubscription(request, authToken)
    }
    if (request instanceof DeleteSubscriptionsRequest) {
      return this.subscriptionSvc.deleteSubscriptions(request, authToken)
    }
    if (request instanceof SetPublishingModeRequest) {
      return this.subscriptionSvc.setPublishingMode(request, authToken)
    }
    if (request instanceof PublishRequest) {
      return this.subscriptionSvc.publish(request, authToken)
    }
    if (request instanceof RepublishRequest) {
      return this.subscriptionSvc.republish(request, authToken)
    }
    if (request instanceof CreateMonitoredItemsRequest) {
      return this.monitoredItemSvc.createMonitoredItems(request, authToken)
    }
    if (request instanceof ModifyMonitoredItemsRequest) {
      return this.monitoredItemSvc.modifyMonitoredItems(request, authToken)
    }
    if (request instanceof DeleteMonitoredItemsRequest) {
      return this.monitoredItemSvc.deleteMonitoredItems(request, authToken)
    }
    if (request instanceof SetMonitoringModeRequest) {
      return this.monitoredItemSvc.setMonitoringMode(request, authToken)
    }

    this.logger.warn(`Unhandled request type: ${request.constructor.name}`)
    return makeServiceFault(extractRequestHandle(request), StatusCode.BadServiceUnsupported)
  }
}

// ── module-level helpers ───────────────────────────────────────────────────

type RequestLike = {
  requestHeader?: {
    authenticationToken?: NodeId
    requestHandle?: number
    timestamp?: Date
    timeoutHint?: number
  }
}

function extractAuthToken(request: IOpcType): NodeId | undefined {
  return (request as RequestLike).requestHeader?.authenticationToken
}

function extractRequestHandle(request: IOpcType): number {
  return (request as RequestLike).requestHeader?.requestHandle ?? 0
}

/**
 * Session General Service Behaviour (OPC UA Part 4 §5.6.1): if the request
 * has already sat longer than its `timeoutHint` (milliseconds) since it was
 * timestamped by the client, the server rejects it instead of processing it.
 * A `timeoutHint` of 0 (or absent) means "no timeout".
 */
function isRequestStale(request: IOpcType): boolean {
  const header = (request as RequestLike).requestHeader
  if (header?.timeoutHint == null || header.timeoutHint <= 0 || header.timestamp == null) {
    return false
  }
  const elapsedMs = Date.now() - header.timestamp.getTime()
  return elapsedMs > header.timeoutHint
}

function makeServiceFault(requestHandle: number, statusCode: StatusCode): ServiceFault {
  const header = new ResponseHeader()
  header.timestamp = new Date()
  header.requestHandle = requestHandle
  header.serviceResult = statusCode
  header.serviceDiagnostics = new DiagnosticInfo()
  header.stringTable = []
  header.additionalHeader = ExtensionObject.newEmpty()

  const fault = new ServiceFault()
  fault.responseHeader = header
  return fault
}
