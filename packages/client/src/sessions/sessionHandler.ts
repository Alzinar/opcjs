import { ConfigurationClient } from "../configuration/configurationClient";
import { EndpointDescription, ISecureChannel, NodeId, UserTokenTypeEnum, getLogger } from "opcjs-base";
import { SessionService } from "../services/sessionService";
import { UserIdentity } from "../userIdentity";
import { Session } from "./session";
import { CertificateRequiredError } from "./certificateRequiredError.js";

export class SessionHandler {
    private sessionServices: SessionService;
    private logger = getLogger("sessions.SessionHandler");

    async createNewSession(identity:UserIdentity) : Promise<Session>{
        // Security Certificate Administration: when a site-specific ApplicationInstanceCertificate
        // is configured, send it proactively on the first CreateSession attempt instead of waiting
        // for the server to reject an uncertified request. When no certificate is configured, fall
        // back to the OPC UA 1.0 compatibility path: attempt without a certificate, and only if the
        // server signals that one is required, surface a clear error (there is nothing to retry with).
        const configuredCert = this.configuration.securityConfiguration?.applicationInstanceCertificate
        let sessionResult: Awaited<ReturnType<SessionService['createSession']>>
        try {
            sessionResult = await this.sessionServices.createSession(configuredCert ?? null)
        } catch (err) {
            if (err instanceof CertificateRequiredError) {
                if (configuredCert) {
                    // A certificate was already sent and still rejected; no further fallback is possible.
                    this.logger.warn(
                        'Server rejected CreateSession despite the configured applicationInstanceCertificate.',
                    )
                    throw err
                }
                this.logger.warn(
                    'Server requires a client certificate but no applicationInstanceCertificate ' +
                    'is configured in securityConfiguration. Cannot complete the 1.0 fallback.',
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

        await session.activateSession(identity);
        return session;
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

    constructor(secureChannel:ISecureChannel, private configuration: ConfigurationClient) {
        this.sessionServices = new SessionService(NodeId.newTwoByte(0), secureChannel, configuration);
    }
}