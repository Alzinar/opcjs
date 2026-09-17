import { ConfigurationClient } from "../configuration/configurationClient";
import { EndpointDescription, ICertificateStore, ISecureChannel, NodeId, UserTokenTypeEnum, getLogger } from "opcjs-base";
import { SessionService } from "../services/sessionService";
import { UserIdentity } from "../userIdentity";
import { Session } from "./session";
import { CertificateRequiredError } from "./certificateRequiredError.js";
import { ServerCertificateRejectedError } from "./serverCertificateRejectedError.js";

export class SessionHandler {
    private sessionServices: SessionService;
    private logger = getLogger("sessions.SessionHandler");

    async createNewSession(identity:UserIdentity) : Promise<Session>{
        // Security Certificate Administration: when a site-specific ApplicationInstanceCertificate
        // is configured, send it proactively on the first CreateSession attempt instead of waiting
        // for the server to reject an uncertified request. When no certificate is configured, fall
        // back to this client's own certificate store (if one already has a generated "own" cert),
        // and finally to the OPC UA 1.0 compatibility path: attempt without a certificate, and only
        // if the server signals that one is required, surface a clear error.
        let certificateToSend = this.configuration.securityConfiguration?.applicationInstanceCertificate ?? null
        if (!certificateToSend) {
            const own = await this.certificateStore.getOwn()
            if (own) certificateToSend = own.certificate
        }

        let sessionResult: Awaited<ReturnType<SessionService['createSession']>>
        try {
            sessionResult = await this.sessionServices.createSession(certificateToSend)
        } catch (err) {
            if (err instanceof CertificateRequiredError) {
                if (certificateToSend) {
                    // A certificate was already sent and still rejected; no further fallback is possible.
                    this.logger.warn(
                        'Server rejected CreateSession despite the configured/own applicationInstanceCertificate.',
                    )
                    throw err
                }
                this.logger.warn(
                    'Server requires a client certificate but no applicationInstanceCertificate ' +
                    'is configured or available in the certificate store. Cannot complete the 1.0 fallback.',
                )
                throw err
            }
            throw err
        }

        this.sessionServices = this.sessionServices.recreate(sessionResult.authToken)

        const session = new Session(sessionResult.sessionId, sessionResult.authToken, sessionResult.endpoint, this.sessionServices);

        // Enforce user-token type restrictions from the client security configuration
        // before activating; the endpoint is now known from CreateSession.
        this.validateUserTokenPolicy(identity, sessionResult.endpoint)

        // Security Admin – Certificate Management (OPC 10000-6 §6.2): validate the server's
        // certificate before activating the session. Skipped when the endpoint has no
        // certificate (SecurityPolicy None with no cert, the current default case).
        await this.validateServerCertificate(sessionResult.endpoint)

        await session.activateSession(identity);
        return session;
    }

    /**
     * Validates the server certificate received in `CreateSessionResponse.endpoint.serverCertificate`
     * using the configured `validateServerCertificate` override, or the default that delegates to
     * `ICertificateStore.validate()`.
     *
     * @throws {ServerCertificateRejectedError} when validation reports `'rejected'`.
     */
    private async validateServerCertificate(endpoint: EndpointDescription): Promise<void> {
        const serverCertificate = endpoint.serverCertificate
        if (!serverCertificate || serverCertificate.length === 0) return

        const validate = this.configuration.securityConfiguration?.validateServerCertificate
            ?? ((cert: Uint8Array, certStore: ICertificateStore, uri?: string) => certStore.validate(cert, uri))

        const expectedApplicationUri = endpoint.server?.applicationUri ?? undefined
        const result = await validate(serverCertificate, this.certificateStore, expectedApplicationUri)
        if (result.status === 'rejected') {
            this.logger.warn(`Server certificate rejected: ${result.reason ?? 'no reason given'}`)
            throw new ServerCertificateRejectedError(result.reason)
        }
    }

    /**
     * Attempts to reactivate an existing OPC UA session on the current (new) SecureChannel
     * without calling CreateSession first (OPC UA Part 4, Section 5.7.3).
     *
     * This is the preferred recovery path when the SecureChannel drops but the server-side
     * session has not yet timed out: only a new channel is needed, not a new session.
     *
     * @returns The reactivated Session if ActivateSession succeeded, or `null` if the server
     *          rejected the request (e.g. the session had already expired).
     */
    async tryActivateExistingSession(
        existingAuthToken: NodeId,
        existingSessionId: number,
        existingEndpoint: EndpointDescription,
        identity: UserIdentity,
    ): Promise<Session | null> {
        // Build a SessionService bound to the existing auth token so the RequestHeader
        // carries it and the server can correlate the ActivateSession to the right session.
        const serviceForExistingSession = this.sessionServices.recreate(existingAuthToken)
        try {
            const session = new Session(existingSessionId, existingAuthToken, existingEndpoint, serviceForExistingSession)
            await session.activateSession(identity)
            return session
        } catch (err) {
            this.logger.debug('ActivateSession for existing session failed:', err)
            return null
        }
    }

    /**
     * Closes the active session on the server (OPC UA Part 4, Section 5.7.4).
     * @param deleteSubscriptions - Forwarded to CloseSessionRequest. Defaults to true.
     */
    async closeSession(deleteSubscriptions = true): Promise<void> {
        await this.sessionServices.closeSession(deleteSubscriptions)
    }

    /**
     * Sends a CancelRequest to the server to abandon a pending service call
     * (OPC UA Part 4, Section 5.7.5).
     *
     * @param requestHandle - The `requestHandle` from the `RequestHeader` of the
     *   pending request to cancel.
     * @returns The number of requests the server actually cancelled.
     */
    async cancel(requestHandle: number): Promise<number> {
        return this.sessionServices.cancel(requestHandle)
    }

    /**
     * Validates the requested user-identity token type against:
     *   1. The `allowedUserTokenTypes` from the client security configuration — the
     *      client has explicitly restricted which token types it will use.
     *   2. The token policies advertised by the server endpoint — verifies that the
     *      server actually supports at least one of the allowed types.
     *
     * Throws with a descriptive message if either check fails.
     */
    private validateUserTokenPolicy(identity: UserIdentity, endpoint: EndpointDescription): void {
        const allowedTypes = this.configuration.securityConfiguration?.allowedUserTokenTypes
        if (!allowedTypes) return   // no restriction configured

        const requestedType = identity.getTokenType()

        // 1. Client-side restriction: the chosen identity must be an allowed type.
        if (!allowedTypes.includes(requestedType)) {
            throw new Error(
                `User token type '${UserTokenTypeEnum[requestedType]}' is not permitted by the ` +
                `client security configuration. Allowed types: ` +
                `${allowedTypes.map(t => UserTokenTypeEnum[t]).join(', ')}.`,
            )
        }

        // 2. Server-side availability: at least one allowed type must be offered.
        const serverTypes = endpoint.userIdentityTokens?.map(p => p.tokenType) ?? []
        const intersection = allowedTypes.filter(t => serverTypes.includes(t))
        if (intersection.length === 0) {
            throw new Error(
                `Server endpoint does not offer any user token type from the allowed list: ` +
                `${allowedTypes.map(t => UserTokenTypeEnum[t]).join(', ')}. ` +
                `Server offers: ${serverTypes.map(t => UserTokenTypeEnum[t]).join(', ')}.`,
            )
        }
    }

    // Resolved once by Client at startup (connect()) and passed in here — the store's
    // existence/creation is checked on startup, not lazily inside the session handler.
    constructor(secureChannel: ISecureChannel, private configuration: ConfigurationClient, private certificateStore: ICertificateStore) {
        this.sessionServices = new SessionService(NodeId.newTwoByte(0), secureChannel, configuration);
    }
}