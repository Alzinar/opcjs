# Base Info Estimated Return Time

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support the `EstimatedReturnTime` Property on the `Server` Object. This Property indicates the time at which the server is expected to have a `ServerStatus.State` of `Running` again after a planned shutdown or service interruption. Clients can use this information to govern their reconnect logic and avoid polling too aggressively.

**Server responsibilities**:
- Expose `Server.EstimatedReturnTime` as an optional Property.
- Set it to a valid UTC `DateTime` before initiating a planned shutdown (e.g. for maintenance).
- Set it to `DateTime.MinValue` (null time) when no return time is known.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §8.2 | Server Object / EstimatedReturnTime |
| profiles.opcfoundation.org | [CU 3198](https://profiles.opcfoundation.org/conformanceunit/3198) | Base Info Estimated Return Time |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateOptionalExtras()` creates `EstimatedReturnTime` (`ns=0;i=2992`) as a `HasComponent` child of `ServerStatus`, defaulted to OPC UA `MinDateTime` (`-11_644_473_600_000` ms epoch) to indicate no planned shutdown; writable so an operator/administration path can set it before a planned outage.
