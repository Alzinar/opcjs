# Base Info ValueAsText

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support the `ValueAsText` Property for Variables whose value is an enumerated DataType. This Property provides a human-readable `LocalizedText` representation of the current enumeration value, enabling clients to display the value without needing to decode the enumeration type definition themselves.

**Server responsibilities**:
- Add a `ValueAsText` Property of type `LocalizedText` to Variable nodes whose `DataType` is an enumeration.
- Keep the `ValueAsText` value in sync with the parent Variable's current value (updated whenever the Variable changes).

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §8.9 | ValueAsText Property |
| profiles.opcfoundation.org | [CU 2969](https://profiles.opcfoundation.org/conformanceunit/2969) | Base Info ValueAsText |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` adds a representative enumerated `TrafficLight` Variable (`ns=1;i=25`, `Int32`) with a `ValueAsText` Property (`ns=1;i=26`, `LocalizedText`) giving the human-readable name of the current value.

**Not yet implemented**: `ValueAsText` is set once at startup rather than being kept dynamically in sync with `TrafficLight`'s current value on every `Write` (there is no generic enumeration-DataType-to-name lookup or a `Write` hook that recomputes dependent properties yet).
