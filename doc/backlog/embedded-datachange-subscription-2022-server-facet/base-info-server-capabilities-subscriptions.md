# Base Info Server Capabilities Subscriptions

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Exposes AggregateFunctions, MaxSubscriptions, MaxMonitoredItems, MaxSubscriptionsPerSession and MaxMonitoredItemsPerSubscription of the ServerCapabilities Object as well as MaxMonitoredItemsPerCall of the OperationLimits Object.

These nodes live under `Server/ServerCapabilities` and `Server/ServerCapabilities/OperationLimits` (Part 5 §6.3.2 / §6.3.11). All of these properties are Optional / vendor-configured per the spec (no fixed ns=0 NodeId is assigned), so they are exposed at vendor-specific `ns=1` NodeIds, consistent with `ServerCapabilities_MaxSessions` (see `CustomIds` in `wellKnownIds.ts`).

| BrowseName | NodeId | Type | Value |
|------------|--------|------|-------|
| `MaxSubscriptions` | ns=1;i=28 | UInt32 | 1000 |
| `MaxMonitoredItems` | ns=1;i=29 | UInt32 | 10000 |
| `MaxSubscriptionsPerSession` | ns=1;i=30 | UInt32 | 100 |
| `MaxMonitoredItemsPerSubscription` | ns=1;i=31 | UInt32 | 1000 |
| `MaxMonitoredItemsPerCall` (OperationLimits) | ns=1;i=32 | UInt32 | 1000 |
| `AggregateFunctions` (folder) | ns=1;i=33 | Folder of `AggregateFunctionType` | empty (no HistoryRead aggregates implemented) |

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 §6.3.2 | ServerCapabilitiesType | Capability variables |
| OPC 10000-5 §6.3.11 | OperationLimitsType | Per-service limits |

Online: https://reference.opcfoundation.org/Core/Part5/v105/docs/6.3.2

## Implementation

- `packages/server/src/addressSpace/wellKnownIds.ts` — `CustomIds.ServerCapabilities_MaxSubscriptions` etc.
- `packages/server/src/addressSpace/addressSpace.ts` — `populateServerObject()` creates the variables/folder and links them via `HasProperty` / `HasComponent`.
- Tested in `packages/server/tests/addressSpace.test.ts`.
