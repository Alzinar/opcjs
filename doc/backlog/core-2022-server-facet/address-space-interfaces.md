# Address Space Interfaces

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support Interfaces and the associated rules, including exposing the `InterfaceTypes` entry point and the types `BaseInterfaceType`, `HasInterface` ReferenceType, and all their supertypes in the AddressSpace.

**Server responsibilities**:
- Expose the `InterfaceTypes` Folder in the AddressSpace (`i=17708`).
- Expose the `BaseInterfaceType` ObjectType (`i=17602`).
- Expose the `HasInterface` ReferenceType (`i=17603`).
- For any ObjectType that implements an interface, add a `HasInterface` reference to the interface type.
- For any Object instance that implements an interface, follow the type hierarchy so the interface is discoverable.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §4.6 | Interfaces |
| profiles.opcfoundation.org | [CU 3560](https://profiles.opcfoundation.org/conformanceunit/3560) | Address Space Interfaces |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` creates the `InterfaceTypes` Folder (`ns=0;i=17708`, `Organizes`-linked from `Types`), the `BaseInterfaceType` ObjectType (`ns=0;i=17602`, abstract, subtype of `BaseObjectType`), and the `HasInterface` ReferenceType (`ns=0;i=17603`, subtype of `NonHierarchicalReferences`). A demo `IDemoCapabilityType` interface (`ns=1;i=6`, subtype of `BaseInterfaceType`) is defined, and `ServerCapabilitiesType` is given a `HasInterface` reference to it, demonstrating an ObjectType "implementing" an interface.
