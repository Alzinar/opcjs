# Base Info Server Capabilities MaxMonitoredItemsQueueSize

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Exposes MaxMonitoredItemsQueueSize of the ServerCapabilities Object.

Exposed node:

| BrowseName | NodeId | Type | Value |
|------------|--------|------|-------|
| `MaxMonitoredItemsQueueSize` | ns=1;i=34 | UInt32 | 100 |

The server enforces this limit: `CreateMonitoredItems` and `ModifyMonitoredItems` clamp the requested `queueSize` to `MAX_MONITORED_ITEMS_QUEUE_SIZE` (100), the same constant used to populate this node's value.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 §6.3.2 | ServerCapabilitiesType | `MaxMonitoredItemsQueueSize` |

Online: https://reference.opcfoundation.org/Core/Part5/v105/docs/6.3.2

## Implementation

- `packages/server/src/subscription/monitoredItem.ts` — `MAX_MONITORED_ITEMS_QUEUE_SIZE` constant, shared by the address-space node value and the service-level clamp.
- `packages/server/src/services/monitoredItemService.ts` — clamps `queueSize` in `createMonitoredItems()` / `modifyMonitoredItems()`.
- `packages/server/src/addressSpace/addressSpace.ts` — populates the node.
