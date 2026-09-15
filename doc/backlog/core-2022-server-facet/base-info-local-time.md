# Base Info LocalTime

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must expose local time zone information by providing the `LocalTime` Variable on the `Server` Object, and must expose the `TimeZoneDataType`, its Encoding Object, and all its supertypes in the AddressSpace.

**Server responsibilities**:
- Expose `Server.LocalTime` as a Variable of type `TimeZoneDataType`.
- `TimeZoneDataType` contains:
  - `offset` — offset from UTC in minutes (e.g. `60` for UTC+1)
  - `daylightSavingInOffset` — Boolean indicating whether DST is already applied to the offset
- Expose the `TimeZoneDataType` DataType node and its encoding in the type system.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-3 | §8.32 | TimeZoneDataType |
| OPC 10000-5 | §8.2 | Server Object LocalTime |
| profiles.opcfoundation.org | [CU 2476](https://profiles.opcfoundation.org/conformanceunit/2476) | Base Info LocalTime |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` registers the `TimeZoneDataType` DataType node (`ns=0;i=8912`, subtype of `BaseDataType`) and creates `Server.LocalTime` (`ns=0;i=3711`) as a `HasProperty` child of `Server`, valued as an `ExtensionObject`-encoded `TimeZoneDataType` (`offset = 0`, `daylightSavingInOffset = false`).
- `packages/base` — `TimeZoneDataType` class plus its binary/XML/JSON encoders/decoders already existed in the generated schema and required no changes.
