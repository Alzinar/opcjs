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
| ⚠️ | [subscription-publish-basic.md](./subscription-publish-basic.md) | Subscription Publish Basic |
| ❌ | [subscription-publish-request-queue-overflow.md](./subscription-publish-request-queue-overflow.md) | Subscription PublishRequest Queue Overflow |
| ⚠️ | [monitor-basic.md](./monitor-basic.md) | Monitor Basic |
| ✅ | [monitor-items-2.md](./monitor-items-2.md) | Monitor Items 2 |
| ⚠️ | [monitor-value-change-v2.md](./monitor-value-change-v2.md) | Monitor Value Change V2 |
| ❌ | [base-info-server-capabilities-subscriptions.md](./base-info-server-capabilities-subscriptions.md) | Base Info Server Capabilities Subscriptions |
| ❌ | [base-info-server-capabilities-max-monitored-items-queue-size.md](./base-info-server-capabilities-max-monitored-items-queue-size.md) | Base Info Server Capabilities MaxMonitoredItemsQueueSize |
| ❌ | [base-info-fixed-sampling-interval.md](./base-info-fixed-sampling-interval.md) | Base Info Fixed SamplingInterval |
| ❌ | [base-info-semantic-change-bit.md](./base-info-semantic-change-bit.md) | Base Info SemanticChange Bit |

### Summary

| Total | Implemented | Partial | Missing |
|-------|-------------|---------|---------|
| 10    | 2           | 3       | 5       |

## Implementation Notes

- Implementation lives under `packages/server/src/subscription/` and `packages/server/src/services/`:
  - `subscription.ts` — per-Subscription state machine: publishing timer, keep-alive counter, lifetime counter, sequence number management, acknowledge handling.
  - `monitoredItem.ts` — per-item sampling, change detection via `Variant.equals()`, support for `MonitoringMode.Disabled/Sampling/Reporting`.
  - `subscriptionManager.ts` — owns all Subscriptions, indexed by session.
  - `services/subscriptionService.ts` — CreateSubscription / ModifySubscription / DeleteSubscriptions / SetPublishingMode / Publish / Republish.
  - `services/monitoredItemService.ts` — CreateMonitoredItems / DeleteMonitoredItems.
- The Publish service is implemented as a long-poll: it returns a `Promise<PublishResponse>` that resolves when the chosen subscription has a notification or keep-alive ready. `SecureChannelServer` dispatches service requests without awaiting, so a pending Publish does not block other requests on the same channel.
- On `CloseSession` with `deleteSubscriptions == true`, every Subscription owned by that session is disposed.
