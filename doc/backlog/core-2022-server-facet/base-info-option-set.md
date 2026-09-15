# Base Info OptionSet

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support the `OptionSetType` VariableType. This VariableType is used for Variables that hold a bit-mask value where each bit corresponds to a named option. The `OptionSetType` exposes the list of option names via the `OptionSetValues` Property.

**Server responsibilities**:
- Expose the `OptionSetType` VariableType in the type system.
- For Variables typed as `OptionSetType` (or subtype), expose the `OptionSetValues` Property containing a `LocalizedText[]` where each index corresponds to a bit in the value.
- Optionally expose `BitMask` Property to indicate which bits are valid.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §B.1 | OptionSetType |
| profiles.opcfoundation.org | [CU 3127](https://profiles.opcfoundation.org/conformanceunit/3127) | Base Info OptionSet |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` registers the `OptionSetType` VariableType (`ns=0;i=11488`, subtype of `BaseVariableType`) and adds a representative `StatusFlags` Variable (`ns=1;i=20`, typed `OptionSetType`) with an `OptionSetValues` Property (`ns=1;i=21`, `LocalizedText[]` naming each bit: `Running`, `Alarm`, `Maintenance`).

**Not yet implemented**: the optional `BitMask` Property is not populated.
