# Attribute Read

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ⚠️ Partially Implemented  

## Description

The server must support the `Read` Service to read one or more Attributes of one or more Nodes. This includes support of the `IndexRange` parameter to read a single element or a range of elements when the Attribute value is an array.

**Server responsibilities**:
- Handle `ReadRequest` with one or more `ReadValueId` entries.
- Support reading all Attributes defined in OPC 10000-3 for each NodeClass.
- Honour the `maxAge` parameter: return a cached value if the cached value is no older than `maxAge` milliseconds; `0` means return a live value.
- Support `timestampsToReturn` to control which timestamps are included in the response (`Server`, `Source`, `Both`, `Neither`).
- Support `IndexRange` to read slices of array Attributes.
- Return `Bad_AttributeIdInvalid` for Attributes not applicable to a given NodeClass.
- Return `Bad_IndexRangeNoData` if the requested `IndexRange` is out of bounds.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.10.2 | Read Service |
| OPC 10000-4 | §7.22 | ReadValueId |
| profiles.opcfoundation.org | [CU 3072](https://profiles.opcfoundation.org/conformanceunit/3072) | Attribute Read |

## Implementation

**Files**:
- `packages/server/src/services/attributeService.ts` — `read()` handles `ReadRequest`, applies `timestampsToReturn` (`Source`/`Server`/`Both`/`Neither`)
- `packages/server/src/addressSpace/node.ts` — per-node attribute map backing the reads

**Not yet implemented**:
- `IndexRange` support (array-slice reads) — always returns the full value
- `maxAge` — explicitly ignored, always returns a live value
- `Bad_IndexRangeNoData` is never returned since `IndexRange` is not evaluated
