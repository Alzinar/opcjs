# Address Space Full Array Only

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support setting the `WriteFullArrayOnly` flag in the `AccessLevelEx` Attribute for Variable Nodes of non-scalar data types to indicate whether write operations on an array can be performed with an `IndexRange` (i.e. partial array writes).

If `WriteFullArrayOnly` is set to `1`, only full array writes are permitted; partial writes using an `IndexRange` will be rejected.

**Server responsibilities**:
- Set `AccessLevelEx.WriteFullArrayOnly` for Variable Nodes where partial array writes are not supported.
- Return an appropriate error (`Bad_IndexRangeNoData` or `Bad_WriteNotSupported`) when a client attempts a partial write on such a node.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §5.6.2 | AccessLevelEx Attribute |
| OPC 10000-4 | §5.10.4 | Write Service – IndexRange |
| profiles.opcfoundation.org | [CU 2820](https://profiles.opcfoundation.org/conformanceunit/2820) | Address Space Full Array Only |

## Implementation

**Files**:
- `packages/server/src/addressSpace/node.ts` — `AccessLevelExFlags.WriteFullArrayOnly` (`0x400`) bit mask.
- `packages/server/src/addressSpace/addressSpace.ts` — `populateCoreStructure()` creates a representative `FullArrayOnlyArray` Variable (`ns=1;i=3`) with `AccessLevelEx.WriteFullArrayOnly` set.
- `packages/server/src/services/attributeService.ts` — `write()` reads the target node's `AccessLevelEx`; if `WriteFullArrayOnly` is set and the `WriteValue.indexRange` is non-empty, the write is rejected with `Bad_WriteNotSupported`.
