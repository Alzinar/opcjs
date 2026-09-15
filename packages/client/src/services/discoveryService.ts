import {
    EndpointDescription, GetEndpointsRequest, GetEndpointsResponse, ISecureChannel, NodeId, getLogger,
} from "opcjs-base";
import { ServiceBase } from "./serviceBase.js";

/**
 * Discovery Service Set (OPC UA Part 4, §5.4). Session-less: requests are sent
 * directly over an open SecureChannel, before any Session exists.
 */
// https://reference.opcfoundation.org/Core/Part4/v105/docs/5.4
export class DiscoveryService extends ServiceBase {
    private logger = getLogger("services.DiscoveryService");

    /**
     * Retrieves the EndpointDescriptions supported by the server at `endpointUrl`
     * (OPC UA Part 4, Section 5.4.4 — GetEndpoints Service).
     *
     * Used to implement the Discovery Client Configure Endpoint conformance unit:
     * a client that already knows the server's `endpointUrl` (e.g. from a
     * configuration file) can call this before `Client.connect()` to let the
     * operator or configuration pick the desired SecurityPolicy / MessageSecurityMode,
     * without requiring a prior `FindServers` discovery call.
     *
     * @param endpointUrl - The URL of the endpoint to query (does not need to be the
     *   same as the URL used to open the SecureChannel, though it usually is).
     * @param localeIds - Optional list of locale IDs for the returned ApplicationDescriptions.
     * @param profileUris - Optional list of transport profile URIs to filter results.
     * @returns The list of EndpointDescriptions supported by the server.
     */
    async getEndpoints(
        endpointUrl: string,
        localeIds: string[] = [],
        profileUris: string[] = [],
    ): Promise<EndpointDescription[]> {
        const request = new GetEndpointsRequest();
        request.requestHeader = this.createRequestHeader();
        request.endpointUrl = endpointUrl;
        request.localeIds = localeIds;
        request.profileUris = profileUris;

        this.logger.debug("Sending GetEndpointsRequest...");
        const response = await this.secureChannel.issueServiceRequest(request) as GetEndpointsResponse;

        this.checkServiceResult(response.responseHeader?.serviceResult, 'GetEndpointsRequest');

        return response.endpoints ?? [];
    }

    constructor(secureChannel: ISecureChannel) {
        // GetEndpoints is session-less; the RequestHeader.authenticationToken is
        // ignored by conforming servers, so a null NodeId placeholder is used.
        super(NodeId.newTwoByte(0), secureChannel);
    }
}
