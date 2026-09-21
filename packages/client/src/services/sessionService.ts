import {
    ActivateSessionRequest, ActivateSessionResponse, ApplicationDescription, ApplicationTypeEnum,
    CancelRequest, CancelResponse,
    CloseSessionRequest, CloseSessionResponse,
    Configuration, CreateSessionRequest, CreateSessionResponse, EndpointDescription, ExtensionObject,
    getLogger,
    ISecureChannel, LocalizedText, NodeId, SignatureData, SignedSoftwareCertificate, StatusCode,
    StatusCodeToString, UserIdentityToken,
} from "opcjs-base";
import { ServiceBase } from "./serviceBase";
import { CERTIFICATE_REQUIRED_STATUS_CODES, CertificateRequiredError } from "../sessions/certificateRequiredError.js";

export class SessionService extends ServiceBase {
    private logger = getLogger("services.SessionService");

    /**
     * Creates a new session on the server (OPC UA Part 4, Section 5.7.2).
     *
     * @param clientCertificate - Optional DER-encoded client certificate to include in
     *   the request. Pass `null` (default) for SecurityPolicy None without a cert.
     *   When the server rejects a `null`-cert request with a certificate-related status
     *   code, the caller should retry with a `Uint8Array` certificate (OPC UA 1.0
     *   fallback — see `CertificateRequiredError`).
     * @returns The session ID, authentication token, and selected server endpoint.
     * @throws {CertificateRequiredError} when the server demands a client certificate.
     */
    async createSession(clientCertificate: Uint8Array | null = null): Promise<{ sessionId: number, authToken: NodeId, endpoint: EndpointDescription }> {
        this.logger.debug("Creating session...");

        const clientDescription = new ApplicationDescription();
        clientDescription.applicationUri = this.configuration.applicationUri;
        clientDescription.productUri = this.configuration.productUri;
        clientDescription.applicationName = new LocalizedText(undefined, this.configuration.productName);
        clientDescription.applicationType = ApplicationTypeEnum.Client;
        clientDescription.gatewayServerUri = '';
        clientDescription.discoveryProfileUri = '';
        clientDescription.discoveryUrls = new Array<string>();

        const request = new CreateSessionRequest();
        request.requestHeader = this.createRequestHeader();
        request.clientDescription = clientDescription;
        request.serverUri = '';
        request.endpointUrl = this.secureChannel.getEndpointUrl();
        request.sessionName = '';
        request.clientNonce = null;
        request.clientCertificate = clientCertificate ?? null;
        request.requestedSessionTimeout = 60000;
        request.maxResponseMessageSize = 0;


        // todo: verify endpoints
        // todo: check application uri in server certificate

        this.logger.debug("Sending CreateSessionRequest...");
        const response = await this.secureChannel.issueServiceRequest(request);
        if (!response || !(response instanceof CreateSessionResponse)) {
            throw new Error("Invalid response type for CreateSessionRequest");
        }

        const castedResponse = response as CreateSessionResponse;
        if (!castedResponse || !castedResponse.sessionId || !castedResponse.authenticationToken) {
            throw new Error("CreateSessionResponse missing SessionId or AuthenticationToken");
        }

        const serviceResult = castedResponse.responseHeader?.serviceResult;
        if (serviceResult !== undefined && serviceResult !== StatusCode.Good) {
            if (CERTIFICATE_REQUIRED_STATUS_CODES.has(serviceResult)) {
                throw new CertificateRequiredError(serviceResult);
            }
            throw new Error(`CreateSessionRequest failed: ${StatusCodeToString(serviceResult)}`);
        }

        // The URL the client actually used to connect.
        const clientConnectionUrl = new URL(this.secureChannel.getEndpointUrl())
        const securityMode = this.secureChannel.getSecurityMode()
        const securityPolicyUri = this.secureChannel.getSecurityPolicy()

        // OPC UA Part 4, Section 5.4.4.2: Clients should be prepared to replace
        // the HostName and port returned in the EndpointDescription with the
        // HostName or IP address and port they used to call GetEndpoints. This
        // handles NAT/load-balancer scenarios where the server advertises internal
        // addresses that are unreachable by the client.
        const normalizeEndpointUrl = (serverEndpointUrl: string): URL => {
            const url = new URL(serverEndpointUrl)
            url.hostname = clientConnectionUrl.hostname
            url.port = clientConnectionUrl.port
            return url
        }

        // Some servers prefix the transport scheme with "opc." (e.g. "opc.wss:",
        // per OPC UA Part 6), others report the bare WebSocket scheme (e.g.
        // open62541's "wss:") — strip it from both sides so either form matches.
        const stripOpcSchemePrefix = (protocol: string): string => protocol.replace(/^opc\./, '')

        // Match on protocol and path only; host and port are normalized away so
        // that internally-addressed endpoints are still found.
        const serverEndpoint = castedResponse?.serverEndpoints?.find(currentEndpoint => {
            const normalized = normalizeEndpointUrl(currentEndpoint.endpointUrl as string)
            return stripOpcSchemePrefix(normalized.protocol) === stripOpcSchemePrefix(clientConnectionUrl.protocol)
                && normalized.pathname === clientConnectionUrl.pathname
                && currentEndpoint.securityMode === securityMode
                && currentEndpoint.securityPolicyUri === securityPolicyUri
        })

        if (!serverEndpoint) {
            throw new Error(`Server endpoint ${clientConnectionUrl.toString()} not found in CreateSessionResponse`)
        }

        // Replace the server-reported host and port with the client's actual
        // connection address so downstream code uses the correct URL.
        serverEndpoint.endpointUrl = normalizeEndpointUrl(serverEndpoint.endpointUrl as string).toString()

        // NOTE: per OPC UA Part 4, Section 5.4.4.2 the client shall still verify
        // the HostName it used to open the SecureChannel against the HostName list
        // in the Server Certificate.  This is deferred until certificate-based
        // security (non-None SecurityPolicy) is implemented.

        this.logger.debug("Session created with id:", castedResponse.sessionId.identifier);
        return {
            sessionId: castedResponse.sessionId.identifier as number,
            authToken: castedResponse.authenticationToken,
            endpoint: serverEndpoint
        };
    }

    /**
     * Activates an existing session using the supplied identity token (OPC UA Part 4, Section 5.7.3).
     * @param identityToken - User identity token (anonymous, username/password, certificate, or issued token).
     */
    async activateSession(identityToken: UserIdentityToken): Promise<void> {
        const signatureData = new SignatureData();
        signatureData.algorithm = this.secureChannel.getSecurityPolicy();
        signatureData.signature = new Uint8Array(0);

        const request = new ActivateSessionRequest();
        request.requestHeader = this.createRequestHeader();
        request.clientSignature = signatureData;
        request.clientSoftwareCertificates = new Array<SignedSoftwareCertificate>();
        request.localeIds = ['en-US'];
        request.userIdentityToken = ExtensionObject.newBinary(identityToken);
        request.userTokenSignature = signatureData;

        this.logger.debug("Sending ActivateSessionRequest...");
        const activateResponse = await this.secureChannel.issueServiceRequest(request) as ActivateSessionResponse;

        const activateResult = activateResponse?.responseHeader?.serviceResult;
        if (activateResult !== undefined && activateResult !== StatusCode.Good) {
            throw new Error(`ActivateSessionRequest failed: ${StatusCodeToString(activateResult)}`);
        }

        this.logger.debug("Session activated.");
    }

    /**
     * Sends a CancelRequest to the server asking it to abandon the pending
     * service request identified by `requestHandle` (OPC UA Part 4, Section 5.7.5).
     *
     * The server makes a best-effort attempt to cancel matching requests.
     * Cancelled requests complete with a status of `BadRequestCancelledByClient`.
     *
     * @param requestHandle - The `requestHeader.requestHandle` value of the pending
     *   request to cancel. Pass `0` to attempt to cancel all outstanding requests
     *   (server behaviour for handle 0 is implementation-specific).
     * @returns The number of pending requests that were actually cancelled
     *   (`CancelResponse.cancelCount`).
     */
    async cancel(requestHandle: number): Promise<number> {
        this.logger.debug(`Sending CancelRequest for requestHandle ${requestHandle}...`);

        const request = new CancelRequest();
        request.requestHeader = this.createRequestHeader();
        request.requestHandle = requestHandle;

        const response = await this.secureChannel.issueServiceRequest(request) as CancelResponse;

        const result = response?.responseHeader?.serviceResult;
        if (result !== undefined && result !== StatusCode.Good) {
            throw new Error(`CancelRequest failed: ${StatusCodeToString(result)}`);
        }

        const cancelCount = response?.cancelCount ?? 0;
        this.logger.debug(`CancelRequest completed; cancelCount = ${cancelCount}.`);
        return cancelCount;
    }

    /**
     * Closes the current session on the server (OPC UA Part 4, Section 5.7.4).
     * @param deleteSubscriptions - When true the server deletes all Subscriptions
     *   associated with this Session, freeing their resources immediately.
     *   Pass false to keep Subscriptions alive for transfer to another Session.
     */
    async closeSession(deleteSubscriptions: boolean): Promise<void> {
        this.logger.debug('Sending CloseSessionRequest...')

        const request = new CloseSessionRequest()
        request.requestHeader = this.createRequestHeader()
        request.deleteSubscriptions = deleteSubscriptions

        const response = await this.secureChannel.issueServiceRequest(request) as CloseSessionResponse

        const result = response?.responseHeader?.serviceResult
        if (result !== undefined && result !== StatusCode.Good) {
            throw new Error(`CloseSession failed: ${StatusCodeToString(result)}`)
        }

        this.logger.debug('Session closed.')
    }

    recreate(authToken: NodeId): SessionService {
        return new SessionService(authToken, this.secureChannel, this.configuration)
    }

    constructor(authToken: NodeId, secureChannel: ISecureChannel, private configuration: Configuration) {
        super(authToken, secureChannel)
    }
}