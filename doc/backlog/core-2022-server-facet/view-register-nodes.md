# View RegisterNodes

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support the `RegisterNodes` and `UnregisterNodes` Services as a way to optimise repeated access to specific Nodes in the AddressSpace.

**Server responsibilities**:

### RegisterNodes
- Accept a `RegisterNodesRequest` with a list of `NodeIds`.
- Return a corresponding list of `registeredNodeIds` — the server may return the same NodeIds as-is, or return optimised token NodeIds (e.g. indices into a cached lookup table) to reduce subsequent lookup overhead.
- A registered NodeId is session-scoped; it expires when the session ends.

### UnregisterNodes
- Accept an `UnregisterNodesRequest` with a list of registered NodeIds.
- Release any server-side resources associated with those registrations.
- Silently ignore NodeIds that are not registered (no error).

**Note**: A minimal compliant implementation may simply return the original NodeIds unchanged in `RegisterNodes`, which is valid but provides no performance benefit.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.8.5 | RegisterNodes Service |
| OPC 10000-4 | §5.8.6 | UnregisterNodes Service |
| profiles.opcfoundation.org | [CU 3073](https://profiles.opcfoundation.org/conformanceunit/3073) | View RegisterNodes |

## Implementation

**Files**:
- `packages/server/src/services/viewService.ts` — `registerNodes()`/`unregisterNodes()` implement the minimal-compliant form described in the CU: NodeIds are tracked in `Session.registeredNodes` (a session-scoped `Set<string>`) and returned unchanged; unregistering an unknown NodeId is a no-op.
- `packages/server/src/sessions/session.ts` — `registeredNodes` is cleared when the session ends.
