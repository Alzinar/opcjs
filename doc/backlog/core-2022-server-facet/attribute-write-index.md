# Attribute Write Index

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support the `IndexRange` parameter in `Write` requests to write a single element or a range of elements when the Attribute value is an array and partial updates are allowed for that array.

**Server responsibilities**:
- In `WriteRequest`, process `WriteValue.indexRange` for Variable Nodes with array values.
- Apply the partial write to only the specified elements of the array.
- If the node does not support partial writes (see [Address Space Full Array Only](./address-space-full-array-only.md)), return `Bad_IndexRangeNoData` or `Bad_WriteNotSupported`.
- Validate that the written sub-array has a compatible type and length for the specified range.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.10.4 | Write Service |
| OPC 10000-4 | §7.22 | NumericRange (IndexRange) |
| profiles.opcfoundation.org | [CU 3147](https://profiles.opcfoundation.org/conformanceunit/3147) | Attribute Write Index |

## Implementation

**Files**:
- `packages/server/src/services/attributeService.ts` — `mergeIndexRange()` parses `WriteValue.indexRange` (via `NumericRange.parse`) and merges the supplied sub-array into the current array value; returns `Bad_IndexRangeInvalid`/`Bad_IndexRangeNoData` for malformed or out-of-bounds ranges, and `Bad_WriteNotSupported` when the target has `AccessLevelEx.WriteFullArrayOnly` set.
