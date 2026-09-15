# Documentation – Core Capacities

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server application documentation must specify the core OPC UA-related capacities so that system integrators and operators can understand the server's limits.

**Required documentation**:
- Number of supported `SecureChannels`
- Number of supported concurrent `Sessions`
- Number of continuation points for View Services (Browse, BrowseNext)

**If Subscriptions are supported**, the documentation must also include:
- Number of supported Subscriptions
- Number of supported concurrent Publish requests
- Number of MonitoredItems per Subscription
- Size of the retransmission queue
- Size of the queue for sampled MonitoredItems

These capacity values must also be exposed in the `ServerCapabilities` Object in the AddressSpace (see [Base Info Server Capabilities 2](./base-info-server-capabilities-2.md)).

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §8.2 | ServerCapabilities Object |
| profiles.opcfoundation.org | [CU 3808](https://profiles.opcfoundation.org/conformanceunit/3808) | Documentation – Core Capacities |

## Implementation

**Files**:
- `packages/server/README.md` — "Server capacities" section documents the fixed capacity values for integrators/operators.
- `packages/server/src/addressSpace/addressSpace.ts` — the same values are exposed live in the `ServerCapabilities` Object (see [base-info-server-capabilities-2.md](./base-info-server-capabilities-2.md)).

Current values: unlimited SecureChannels (one `ws` connection per accepted socket), `MaxSessions` = 100, `MaxBrowseContinuationPoints` = 10 per session. Subscriptions are supported but have no configured caps yet (unbounded MonitoredItems/Subscriptions/retransmission queue), so those are documented as "unbounded" rather than a specific number.
