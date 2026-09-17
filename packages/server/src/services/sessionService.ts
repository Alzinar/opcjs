import {
  ActivateSessionRequest,
  ActivateSessionResponse,
  ApplicationDescription,
  ApplicationTypeEnum,
  CloseSessionRequest,
  CloseSessionResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  EndpointDescription,
  LocalizedText,
  MessageSecurityModeEnum,
  NodeId,
  SignatureData,
  StatusCode,
  UserTokenPolicy,
  UserTokenTypeEnum,
  getLogger,
} from 'opcjs-base'
import type { ILogger } from 'opcjs-base'

import type { ConfigurationServer } from '../configuration/configurationServer.js'
import { SessionError } from '../sessions/sessionManager.js'
import type { SessionManager } from '../sessions/sessionManager.js'
import type { SubscriptionManager } from '../subscription/subscriptionManager.js'
import { SECURITY_POLICY_NONE, TRANSPORT_PROFILE_WS } from './constants.js'
import { makeResponseHeader } from './responseHeader.js'

/**
 * Handles the three session lifecycle requests:
 * `CreateSession`, `ActivateSession`, and `CloseSession`.
 *
 * @see OPC UA Part 4 §5.6
 */
export class SessionService {
  private readonly logger: ILogger

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly config: ConfigurationServer,
    private endpointUrl: string,
    private readonly subscriptionManager?: SubscriptionManager,
  ) {
    this.logger = getLogger('services.SessionService')
  }

  /** Updates the endpoint URL after the listener has bound to an OS-assigned port. */
  updateEndpointUrl(url: string): void {
    this.endpointUrl = url
  }

  /**
   * Handles `CreateSessionRequest`.
   *
   * Creates a new (non-activated) session with a unique `sessionId` and
   * `authenticationToken`.  Returns the server's endpoint description array
   * so the client can verify it connected to the right server.
   *
   * Does not require an existing session; callable without authentication.
   *
   * @see OPC UA Part 4 §5.6.2
   */
  async createSession(request: CreateSessionRequest, channelId: number): Promise<CreateSessionResponse> {
    const requestHandle = request.requestHeader?.requestHandle ?? 0

    const session = this.sessionManager.createSession(
      channelId,
      request.requestedSessionTimeout ?? this.config.maxSessionTimeoutMs,
    )

    const serverDescription = this.makeApplicationDescription()
    const endpoint = this.makeEndpointDescription(serverDescription)

    const serverSignature = new SignatureData()
    serverSignature.algorithm = null
    serverSignature.signature = null

    // Security Admin – Certificate Management (OPC 10000-6 §6.2): serve this
    // server's own application instance certificate when a store is configured.
    // Full incoming client-certificate validation is out of scope here.
    const own = this.config.certificateStore ? await this.config.certificateStore.getOwn() : null

    const response = new CreateSessionResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.sessionId = session.sessionId
    response.authenticationToken = session.authenticationToken
    response.revisedSessionTimeout = session.revisedTimeoutMs
    response.serverNonce = session.serverNonce
    response.serverCertificate = own?.certificate ?? null
    response.serverEndpoints = [endpoint]
    response.serverSoftwareCertificates = []
    response.serverSignature = serverSignature
    response.maxRequestMessageSize = 0

    this.logger.debug(
      `Session created: ${session.sessionId.toString()} (channel=${channelId})`,
    )

    return response
  }

  /**
   * Handles `ActivateSessionRequest`.
   *
   * Validates the identity token and binds the session to the supplied channel.
   * Returns a fresh `serverNonce`.
   *
   * Bypasses full-activation check — the session must *exist* but need not be
   * activated yet (first ActivateSession after CreateSession).
   *
   * @see OPC UA Part 4 §5.6.3
   */
  activateSession(request: ActivateSessionRequest, channelId: number): ActivateSessionResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const authToken = request.requestHeader?.authenticationToken ?? new NodeId()

    const response = new ActivateSessionResponse()

    try {
      const session = this.sessionManager.activateSession(
        authToken,
        request.userIdentityToken,
        channelId,
      )

      const newNonce = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        newNonce[i] = Math.floor(Math.random() * 256)
      }

      response.responseHeader = makeResponseHeader(requestHandle)
      response.serverNonce = newNonce
      response.results = []
      response.diagnosticInfos = []

      this.logger.debug(`Session activated: ${session.sessionId.toString()}`)
    } catch (err) {
      const code =
        err instanceof SessionError
          ? err.statusCode
          : StatusCode.BadUnexpectedError

      response.responseHeader = makeResponseHeader(requestHandle, code)
      response.serverNonce = null
      response.results = []
      response.diagnosticInfos = []
    }

    return response
  }

  /**
   * Handles `CloseSessionRequest`.
   *
   * Closes the session identified by the `authenticationToken` in the request
   * header.  The session must already be validated by the dispatcher before
   * this method is called.
   *
   * @see OPC UA Part 4 §5.6.4
   */
  closeSession(request: CloseSessionRequest): CloseSessionResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const authToken = request.requestHeader?.authenticationToken ?? new NodeId()

    if (request.deleteSubscriptions) {
      this.subscriptionManager?.deleteSubscriptionsOfSession(authToken)
    }
    this.sessionManager.closeSession(authToken)

    this.logger.debug(`Session closed (token=${authToken.toString()})`)

    const response = new CloseSessionResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    return response
  }

  // ── private helpers ─────────────────────────────────────────────────────

  private makeApplicationDescription(): ApplicationDescription {
    const desc = new ApplicationDescription()
    desc.applicationUri = this.config.applicationUri
    desc.productUri = this.config.applicationUri
    desc.applicationName = new LocalizedText('en', this.config.productName)
    desc.applicationType = ApplicationTypeEnum.Server
    desc.gatewayServerUri = null
    desc.discoveryProfileUri = null
    desc.discoveryUrls = [this.endpointUrl]
    return desc
  }

  private makeEndpointDescription(server: ApplicationDescription): EndpointDescription {
    const anonPolicy = new UserTokenPolicy()
    anonPolicy.policyId = 'anonymous'
    anonPolicy.tokenType = UserTokenTypeEnum.Anonymous
    anonPolicy.issuedTokenType = null
    anonPolicy.issuerEndpointUrl = null
    anonPolicy.securityPolicyUri = null

    const ep = new EndpointDescription()
    ep.endpointUrl = this.endpointUrl
    ep.server = server
    ep.serverCertificate = null
    ep.securityMode = MessageSecurityModeEnum.None
    ep.securityPolicyUri = SECURITY_POLICY_NONE
    ep.userIdentityTokens = [anonPolicy]
    ep.transportProfileUri = TRANSPORT_PROFILE_WS
    ep.securityLevel = 0
    return ep
  }
}
