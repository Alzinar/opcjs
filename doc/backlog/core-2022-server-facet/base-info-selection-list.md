# Base Info Selection List

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support Variables of the `SelectionListType` VariableType. This VariableType represents a Variable whose value is constrained to one of a predefined list of options, exposed as the `Selections` and `SelectionDescriptions` Properties.

**Server responsibilities**:
- Expose the `SelectionListType` VariableType in the type system.
- For Variables typed as `SelectionListType`, expose:
  - `Selections` Property — array of `BaseDataType` values representing the valid choices
  - `SelectionDescriptions` Property — optional `LocalizedText[]` describing each selection
  - `RestrictToList` Property — Boolean indicating whether only listed values are valid

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §B.5 | SelectionListType |
| profiles.opcfoundation.org | [CU 2711](https://profiles.opcfoundation.org/conformanceunit/2711) | Base Info Selection List |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` registers the `SelectionListType` VariableType (`ns=0;i=19726`, subtype of `BaseVariableType`) and adds a representative `Mode` Variable (`ns=1;i=22`, typed `SelectionListType`) with `Selections` (`ns=1;i=23`: `Auto`/`Manual`/`Off`) and `SelectionDescriptions` (`ns=1;i=24`) Properties.
- `packages/client/src/selectionList.ts` — the existing client-side `SelectionListType` reader (Core 2022 Client Facet) can already consume this server-side representation end-to-end.

**Not yet implemented**: the optional `RestrictToList` Property is not populated.
