# Base Info Fixed SamplingInterval

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Exposes diagnostic information on fixed sampling intervals (`SamplingIntervalDiagnosticsArray`) when the Server is handling subscriptions with fixed sampling intervals and the `EnabledFlag` in the `ServerDiagnostics` Object is set to TRUE.

Every MonitoredItem's sampling interval is fixed to its owning Subscription's `publishingInterval` (the server never offers a distinct per-item sampling interval), which is exactly the "fixed sampling interval" model this CU targets.

Exposed nodes:

| BrowseName | NodeId | Type |
|------------|--------|------|
| `Server/ServerDiagnostics` | ns=1;i=35 | Object |
| `Server/ServerDiagnostics/EnabledFlag` | ns=1;i=36 | Boolean (read/write, default `false`) |
| `Server/ServerDiagnostics/SamplingIntervalDiagnosticsArray` | ns=1;i=37 | `SamplingIntervalDiagnosticsDataType[]` |

`SamplingIntervalDiagnosticsArray` reads as an empty array while `EnabledFlag` is `false`. Once set to `true`, it aggregates every live, non-disabled MonitoredItem across every Subscription by sampling interval, reporting `monitoredItemCount` and `disabledMonitoredItemCount` per distinct interval.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 §6.3.13 | ServerDiagnosticsType | `SamplingIntervalDiagnosticsArray` |

Online: https://reference.opcfoundation.org/Core/Part5/v105/docs/6.3.3

## Implementation

- `packages/server/src/subscription/subscriptionManager.ts` — `getSamplingIntervalDiagnostics()` aggregates live data across all Subscriptions.
- `packages/server/src/subscription/subscription.ts` — `monitoredItemDiagnostics()` generator exposes each item's sampling interval / monitoring mode.
- `packages/server/src/addressSpace/addressSpace.ts` — `wireSubscriptionDiagnostics()` installs a `VariableNode` value provider gated by `EnabledFlag`; called from `OpcUaServer.start()`.
