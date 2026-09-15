import { ExpandedNodeId, NodeId } from "opcjs-base";

/**
 * Thrown when the client encounters an `ExpandedNodeId` that references a Node
 * on a different OPC UA server (Base Info Client Remote Nodes conformance unit,
 * OPC UA Part 3, §8.2 / Part 4, §5.8).
 *
 * This client does not maintain a multi-server discovery registry or automatically
 * open connections to foreign servers. Callers that need to follow a reference to
 * a remote Node must pre-configure a separate `Client` for that server (e.g. using
 * connection information resolved out-of-band, or via `serverIndex`/`namespaceUri`
 * mapped to a known endpoint) and issue the request there instead.
 */
export class RemoteNodeError extends Error {
    constructor(public readonly expandedNodeId: ExpandedNodeId) {
        const serverIndex = expandedNodeId.serverIndex ?? 0;
        const namespaceUri = expandedNodeId.namespaceUri;
        super(
            `Node ${expandedNodeId.toString()} belongs to a different server ` +
            `(serverIndex=${serverIndex}${namespaceUri ? `, namespaceUri=${namespaceUri}` : ''}). ` +
            'This client does not automatically connect to remote servers; pre-configure a ' +
            'separate Client for the target server using its own connection information.',
        );
        this.name = 'RemoteNodeError';
    }
}

/**
 * Returns true when `expandedNodeId` references a Node on a server other than
 * the one it was received from (Base Info Client Remote Nodes conformance unit).
 *
 * Per OPC UA Part 4, §5.8.2.2: a non-zero `serverIndex` is an index into the
 * Server's `ServerArray` identifying a different server. A `namespaceUri` is
 * also treated as a remote indicator, since it signals that the namespace
 * cannot be resolved through this server's local `NamespaceArray` alone.
 */
export function isRemoteNode(expandedNodeId: ExpandedNodeId): boolean {
    return (expandedNodeId.serverIndex !== undefined && expandedNodeId.serverIndex !== 0)
        || (expandedNodeId.namespaceUri !== undefined && expandedNodeId.namespaceUri !== '');
}

/**
 * Resolves `expandedNodeId` to a local `NodeId` for use with this client's session.
 *
 * @throws {RemoteNodeError} when `isRemoteNode(expandedNodeId)` is true — the Node
 *   cannot be resolved against the currently connected server.
 */
export function resolveLocalNodeId(expandedNodeId: ExpandedNodeId): NodeId {
    if (isRemoteNode(expandedNodeId)) {
        throw new RemoteNodeError(expandedNodeId);
    }
    return expandedNodeId.nodeId;
}
