# Base Info Client Remote Nodes

**Facet**: Base Client Behaviour Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Implementation

- `isRemoteNode(expandedNodeId)` (`packages/client/src/remoteNode.ts`) recognises an `ExpandedNodeId` with `serverIndex > 0` or a non-empty `namespaceUri` as referencing a Node on a different server.
- `BrowseNodeResult.isRemote()` exposes this on browse results so callers can detect remote references without extra imports.
- `resolveLocalNodeId(expandedNodeId)` returns the local `NodeId` for a local reference and throws a descriptive `RemoteNodeError` for a remote one, per the CU's "handle cases where the referenced server is not available gracefully" requirement.
- `Client.browse(..., recursive: true)` skips (with a debug log) remote nodes when recursing, rather than silently mis-resolving them as local NodeIds. This client has no multi-server discovery registry; connecting to the referenced server requires pre-configuring a separate `Client` with that server's connection info, which the CU explicitly allows ("acceptable for the target server's connection information to be pre-configured on the client rather than discovered dynamically").

## Description

The client must be able to access nodes that have an extended NodeId that references a server different from the originating server. It is acceptable for the target server's connection information to be pre-configured on the client rather than discovered dynamically.

This is relevant when browsing an aggregating server or when following references that point to nodes on remote servers (using `ExpandedNodeId` with a non-local server URI or server index).

**Client responsibilities**:
- Recognise `ExpandedNodeId` values where `serverIndex > 0` or `namespaceUri` points to an external server.
- Connect to the referenced server (using pre-configured or dynamically discovered endpoint information) to access the target nodes.
- Handle cases where the referenced server is not available gracefully.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §8.2 | ExpandedNodeId |
| OPC 10000-4 | §5.8 | Attribute Services (Read across servers) |
| profiles.opcfoundation.org | [CU 3077](https://profiles.opcfoundation.org/conformanceunit/3077) | Base Info Client Remote Nodes |
