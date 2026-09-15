# Address Space AddIn Reference

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support the `HasAddIn` Reference to bind an AddIn to an Object or ObjectType. AddIns are a pattern that allows extending an existing type instance without subtyping — the AddIn is an Object that adds behaviours to the owning object via a `HasAddIn` reference.

**Server responsibilities**:
- Expose `HasAddIn` references from Object or ObjectType nodes to their AddIn Objects.
- Ensure AddIn Objects are themselves properly typed (i.e. have a `HasTypeDefinition` reference).
- Process Browse requests that follow `HasAddIn` references.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §4.5 | AddIn pattern |
| profiles.opcfoundation.org | [CU 2446](https://profiles.opcfoundation.org/conformanceunit/2446) | Address Space AddIn Reference |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` registers a `HasAddIn` ReferenceType (custom NodeId `ns=1;i=5` — the canonical ns=0 NodeId was not available in this codebase's reference tables — subtype of `NonHierarchicalReferences`) and links `Server` to its `Locations` Object via `HasAddIn`, demonstrating Browse-visible AddIn binding.
