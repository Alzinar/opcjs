# Embedded DataChange Subscription 2022 Server Facet

**Specification**: OPC 10000-7 §6.5.x (Profiles), version 1.05  
**Profile URI**: `http://opcfoundation.org/UA-Profile/Server/EmbeddedDataChangeSubscription2022`  
**Category**: Server – Subscriptions  
**Profile group**: UACore 1.05  

## Overview

This facet specifies the minimum level of support for data-change notifications within subscriptions. It minimises memory and processing overhead and is geared toward platforms such as the Nano or Micro Embedded Device Server profiles. It supersedes the deprecated *Embedded DataChange Subscription Server Facet*.

The recommended footprint is:
- One Subscription with up to two Monitored Items per Session
- At least two parallel Publish requests per Session

It includes functionality to create, modify, and delete Subscriptions and to add, modify, and remove Monitored Items.

## Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [subscription-basic.md](./subscription-basic.md) | Subscription Basic |
| ✅ | [subscription-publish-basic.md](./subscription-publish-basic.md) | Subscription Publish Basic |
| ✅ | [subscription-publish-request-queue-overflow.md](./subscription-publish-request-queue-overflow.md) | Subscription PublishRequest Queue Overflow |
| ✅ | [monitor-basic.md](./monitor-basic.md) | Monitor Basic |
| ✅ | [monitor-items-2.md](./monitor-items-2.md) | Monitor Items 2 |
| ✅ | [monitor-value-change-v2.md](./monitor-value-change-v2.md) | Monitor Value Change V2 |
| ✅ | [base-info-server-capabilities-subscriptions.md](./base-info-server-capabilities-subscriptions.md) | Base Info Server Capabilities Subscriptions |
| ✅ | [base-info-server-capabilities-max-monitored-items-queue-size.md](./base-info-server-capabilities-max-monitored-items-queue-size.md) | Base Info Server Capabilities MaxMonitoredItemsQueueSize |
| ✅ | [base-info-fixed-sampling-interval.md](./base-info-fixed-sampling-interval.md) | Base Info Fixed SamplingInterval |
| ✅ | [base-info-semantic-change-bit.md](./base-info-semantic-change-bit.md) | Base Info SemanticChange Bit |

### Summary

| Total | Implemented | Partial | Missing |
|-------|-------------|---------|---------|
| 10    | 10          | 0       | 0       |

## Implementation Notes

- Implementation lives under `packages/server/src/subscription/` and `packages/server/src/services/`:
  - `subscription.ts` — per-Subscription state machine: publishing timer, keep-alive counter, lifetime counter, sequence number management, acknowledge handling, `ModifyMonitoredItems`/`SetMonitoringMode`/semantic-change dispatch.
  - `monitoredItem.ts` — per-item sampling, change detection via `Variant.equals()`, `IndexRange` application, `SemanticsChanged` StatusCode bit, support for `MonitoringMode.Disabled/Sampling/Reporting`.
  - `publishRequestQueue.ts` — session-scoped (shared by every Subscription of one session) FIFO queue of parked Publish requests, capped at 10; overflow resolves the oldest with `Bad_TooManyPublishRequests`.
  - `subscriptionManager.ts` — owns all Subscriptions and each session's `PublishRequestQueue`; aggregates live `SamplingIntervalDiagnosticsArray` data.
  - `services/subscriptionService.ts` — CreateSubscription / ModifySubscription / DeleteSubscriptions / SetPublishingMode / Publish / Republish.
  - `services/monitoredItemService.ts` — CreateMonitoredItems / ModifyMonitoredItems / DeleteMonitoredItems / SetMonitoringMode.
  - `services/indexRangeUtil.ts` — shared `IndexRange` slicing logic used by both the Read service and Monitored Item sampling.
- The Publish service is implemented as a long-poll: it returns a `Promise<PublishResponse>` that resolves when the chosen subscription has a notification or keep-alive ready. `SecureChannelServer` dispatches service requests without awaiting, so a pending Publish does not block other requests on the same channel.
- On `CloseSession` with `deleteSubscriptions == true`, every Subscription owned by that session is disposed; once a session's last Subscription is removed, any Publish requests still parked in its `PublishRequestQueue` are resolved with `Bad_NoSubscription`.
- `Server/ServerCapabilities` now exposes `MaxSubscriptions`, `MaxMonitoredItems`, `MaxSubscriptionsPerSession`, `MaxMonitoredItemsPerSubscription`, `MaxMonitoredItemsQueueSize`, and an `AggregateFunctions` folder; `OperationLimits` exposes `MaxMonitoredItemsPerCall`. These live at vendor-specific `ns=1` NodeIds (`CustomIds` in `wellKnownIds.ts`) since the spec leaves them vendor-configured.
- `Server/ServerDiagnostics/SamplingIntervalDiagnosticsArray` is wired to live `SubscriptionManager` data via `AddressSpace.wireSubscriptionDiagnostics()`, and reads as empty unless `Server/ServerDiagnostics/EnabledFlag` is `true` (Part 5 §6.3.13).
- `AttributeService` notifies affected MonitoredItems' `SemanticsChanged` bit when a write targets a known semantic property (`EngineeringUnits`, `EURange`, `Definition`, `ValuePrecision`, `CurrencyUnit`) by walking the inverse `HasProperty` reference to the owning Variable.
