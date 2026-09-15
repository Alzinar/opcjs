# Base Info Engineering Units

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support defining Variables that include the `EngineeringUnits` Property. This Property uses the `EUInformation` DataType, which by default represents UN/CEFACT "Codes for Units of Measurement". If a different EU representation is required, the `EUInformation.namespaceUri` indicates the alternate namespace.

**Server responsibilities**:
- Add an `EngineeringUnits` Property (`EUInformation` DataType) to Variable Nodes that represent measured values with physical units.
- Populate `EUInformation` with:
  - `namespaceUri` — `http://www.opcfoundation.org/UA/units/un/cefact` for standard UN/CEFACT units
  - `unitId` — the UN/CEFACT numeric code
  - `displayName` — e.g. `"m/s"`
  - `description` — e.g. `"metre per second"`

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-8 | §5.6.3 | EUInformation DataType |
| profiles.opcfoundation.org | [CU 2745](https://profiles.opcfoundation.org/conformanceunit/2745) | Base Info Engineering Units |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` registers the `EUInformation` DataType node (`ns=0;i=887`) and adds a representative `Temperature` Variable (`ns=1;i=16`) with an `EngineeringUnits` Property (`ns=1;i=17`) valued as an `ExtensionObject`-encoded `EUInformation` (`namespaceUri = http://www.opcfoundation.org/UA/units/un/cefact`, UN/CEFACT code `Cel`, displayName `°C`).
- `packages/base` — `EUInformation` class and its encoders/decoders already existed in the generated schema.
