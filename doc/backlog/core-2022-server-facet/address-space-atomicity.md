# Address Space Atomicity

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support setting the `NonatomicRead` and `NonatomicWrite` flags in the `AccessLevelEx` Attribute for Variable Nodes to indicate whether Read or Write operations can be performed atomically. If a flag is set to `1`, the server cannot guarantee atomicity for that operation.

**Server responsibilities**:
- Set `AccessLevelEx.NonatomicRead` bit for Variable Nodes whose value cannot be read atomically (e.g. large arrays split across multiple memory locations).
- Set `AccessLevelEx.NonatomicWrite` bit for Variable Nodes whose value cannot be written atomically.
- Clients can inspect these flags to determine whether partial reads/writes may be observed.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §5.6.2 | AccessLevelEx Attribute |
| profiles.opcfoundation.org | [CU 2809](https://profiles.opcfoundation.org/conformanceunit/2809) | Address Space Atomicity |

## Implementation

**Files**:
- `packages/server/src/addressSpace/node.ts` — `AccessLevelExFlags` defines the `NonatomicRead` (`0x100`), `NonatomicWrite` (`0x200`), and `WriteFullArrayOnly` (`0x400`) bit masks; `VariableNode` exposes the `AccessLevelEx` Attribute via its constructor `accessLevelEx` parameter.
- `packages/server/src/services/attributeService.ts` — `Read`/`Write` expose `AttributeId.AccessLevelEx` like any other Attribute.

All in-memory Variable Nodes default `AccessLevelEx` to `0` (atomic reads/writes guaranteed), which is a valid conformant value — the CU requires that the server *support* signalling non-atomicity where applicable, not that every server actually have non-atomic nodes. The mechanism is exercised by the `WriteFullArrayOnly` bit (see [address-space-full-array-only.md](./address-space-full-array-only.md)), demonstrating the same Attribute plumbing used for `NonatomicRead`/`NonatomicWrite`.
