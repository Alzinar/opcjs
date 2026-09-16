# Monitor Value Change V2

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Support creation of MonitoredItems for Attribute value changes. This includes support of the IndexRange to select a single element or a range of elements when the Attribute value is an array.
>
> This ConformanceUnit does not require queuing when multiple value changes occur during a "publish period". I.e. the latest change will be sent in the Notification.

The implementation:

- Samples the Value attribute on each publishing tick.
- Applies `IndexRange` (Part 4 §7.27) to the sampled value via the shared `services/indexRangeUtil.ts` helper (also used by the Read service), returning `Bad_IndexRangeInvalid` at `CreateMonitoredItems` time for syntactically invalid ranges.
- Compares against the last reported (post-IndexRange) value via `Variant.equals` (JSON-based comparison).
- Emits a `DataChangeNotification` only when the sampled value differs from the previously reported value (or a semantic change is pending — see [base-info-semantic-change-bit.md](./base-info-semantic-change-bit.md)).
- Queues at most `max(1, queueSize)` items, clamped to `MaxMonitoredItemsQueueSize`; on overflow the oldest is discarded (queue size of 1 = "latest value wins").

Still not implemented (optional beyond this CU's core requirement):
- `DataChangeFilter` (deadband, status/value trigger) — Part 4 §7.22.
- Per-item `samplingInterval` (every item samples on the Subscription's publishing tick — see [base-info-fixed-sampling-interval.md](./base-info-fixed-sampling-interval.md), which documents this as the intentional "fixed sampling interval" model).

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 §5.13.2 | CreateMonitoredItems | Including `IndexRange` |
| OPC 10000-4 §7.22 | DataChangeFilter | Deadband / change trigger |
| OPC 10000-4 §7.21 | MonitoringParameters | `samplingInterval`, `queueSize`, `discardOldest` |

Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/5.13.2

## Implementation

- `packages/server/src/subscription/monitoredItem.ts` — sampling, `IndexRange` application, change detection, queue.
- `packages/server/src/services/indexRangeUtil.ts` — shared `applyIndexRange()` / slicing logic.
- `packages/server/src/services/monitoredItemService.ts` — validates `IndexRange` syntax at creation time.
