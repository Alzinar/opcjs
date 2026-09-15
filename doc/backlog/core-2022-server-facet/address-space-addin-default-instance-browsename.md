# Address Space AddIn DefaultInstanceBrowsename

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support the `DefaultInstanceBrowseName` Property for ObjectTypes. This property holds a `QualifiedName` that clients should use as the `BrowseName` when creating instances of the ObjectType (if they are allowed to choose the name).

**Server responsibilities**:
- Expose the `DefaultInstanceBrowseName` Property on ObjectType nodes that define a preferred instance name.
- Clients use this hint when creating instances via the Node Management Service Set.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §6.4 | ObjectType DefaultInstanceBrowseName |
| profiles.opcfoundation.org | [CU 2447](https://profiles.opcfoundation.org/conformanceunit/2447) | Address Space AddIn DefaultInstanceBrowsename |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` adds a `DefaultInstanceBrowseName` Property (`ns=1;i=27`, `QualifiedName`) as a `HasProperty` child of `ServerCapabilitiesType`, valued `ServerCapabilities`.
