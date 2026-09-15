# Address Space Base

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support all NodeClasses with their Attributes and References. This forms the structural foundation of the OPC UA AddressSpace.

**Supported NodeClasses**:
- `Object` — instances of ObjectTypes
- `ObjectType` — type definitions for Objects
- `Variable` — data-bearing nodes
- `VariableType` — type definitions for Variables
- `ReferenceType` — defines reference semantics
- `DataType` — defines data type structure
- `Method` — callable operations
- `View` — named subsets of the AddressSpace

**Server responsibilities**:
- Expose all mandatory Attributes for each NodeClass (e.g. `NodeId`, `NodeClass`, `BrowseName`, `DisplayName`, `Description`, `WriteMask`, `UserWriteMask`).
- Correctly populate `References` for each Node, including both forward and inverse hierarchical references.
- Support all built-in ReferenceTypes (`HasComponent`, `HasProperty`, `HasTypeDefinition`, `HasSubtype`, etc.).

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §5 | AddressSpace Model |
| OPC 10000-3 | §8 | NodeClasses and Attributes |
| profiles.opcfoundation.org | [CU 3554](https://profiles.opcfoundation.org/conformanceunit/3554) | Address Space Base |

## Implementation

**Files**:
- `packages/server/src/addressSpace/node.ts` — `OpcUaNode` base class plus `ObjectNode`, `VariableNode`, `ObjectTypeNode`, `VariableTypeNode`, `ReferenceTypeNode`, `DataTypeNode`, `MethodNode`, and `ViewNode` cover all eight NodeClasses, each exposing the mandatory Attributes (`NodeId`, `NodeClass`, `BrowseName`, `DisplayName`, `Description`, `WriteMask`, `UserWriteMask`, plus NodeClass-specific Attributes such as `IsAbstract`, `Executable`, `ContainsNoLoops`).
- `packages/server/src/addressSpace/addressSpace.ts` — in-memory `Map<string, OpcUaNode>` keyed by `NodeId`; `addReference()`/`getNode().getReferences()` maintain both forward and inverse `ReferenceRecord`s. `populateReferenceTypes()` builds the built-in ReferenceType hierarchy (`References`, `HierarchicalReferences`, `NonHierarchicalReferences`, `HasChild`, `Organizes`, `Aggregates`, `HasComponent`, `HasProperty`, `HasTypeDefinition`, `HasSubtype`, `HasEncoding`, `HasDescription`, `HasModellingRule`, `HasEventSource`, `HasNotifier`, `GeneratesEvent`, `HasOrderedComponent`) with the correct `HasSubtype` graph. `populateTypeSystem()` and `populateCoreStructure()` wire up `ObjectType`/`VariableType`/`DataType` subtype graphs and the `Root`/`Objects`/`Types`/`Views` entry points, including at least one representative `Method` and `View` node.
- `packages/server/src/addressSpace/wellKnownIds.ts` — well-known namespace-0 NodeIds for ReferenceTypes, Objects, ObjectTypes, VariableTypes, and DataTypes.
