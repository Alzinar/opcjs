# Subscription Basic

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Support the following Subscription Services: `CreateSubscription`, `ModifySubscription`, `DeleteSubscriptions`, `Publish`, `Republish` and `SetPublishingMode`.

OPC 10000-4 §5.14 defines the full Subscription service set. A Subscription multiplexes data-change and event notifications back to the Client on a periodic publishing interval.

### Services and current support

| Service | Spec § | Status | Notes |
|---------|--------|--------|-------|
| CreateSubscription | 5.14.2 | ✅ | Revises `publishingInterval` (50 ms min, 1 h max), `lifetimeCount` (≥ 3 × `keepAliveCount`), `maxKeepAliveCount`. |
| ModifySubscription | 5.14.3 | ✅ | Revises parameters and re-arms the publishing timer immediately with the new interval; resets keep-alive/lifetime counters. |
| SetPublishingMode | 5.14.4 | ✅ | Enables/disables publishing on a per-subscription basis. |
| Publish | 5.14.5 | ✅ | Long-poll: resolves when a notification or keep-alive is ready. Routes acknowledgements via `Subscription.processAcknowledgements`. |
| Republish | 5.14.6 | ✅ | Returns the retained `NotificationMessage` matching `retransmitSequenceNumber`, or `Bad_MessageNotAvailable` if it is no longer available. |
| DeleteSubscriptions | 5.14.7 | ✅ | Stops the publishing timer and frees resources. |

### Subscription state machine (Part 4 §5.14.1)

The publishing timer fires every `publishingInterval` ms. On each tick the Subscription must:

1. Check whether any Monitored Item has pending notifications.
2. If yes and a Publish request is queued: send a `NotificationMessage`.
3. If no notifications and `keepAliveCounter` has reached `maxKeepAliveCount` and a Publish request is queued: send a keep-alive (a `NotificationMessage` with empty `notificationData`).
4. If `lifetimeCounter` reaches `lifetimeCount`: send a `StatusChangeNotification` with `Bad_Timeout`, then dispose the subscription.

### Sequence numbers

`NotificationMessage.sequenceNumber` starts at 1 and increments per real notification. Keep-alives reuse the *next* sequence number without consuming it (Part 4 §5.14.1.3). Up to 16 unacknowledged messages are retained for republish and returned via `Subscription.republish(sequenceNumber)`.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 §5.14.1 | Subscription state machine | Publishing, keep-alive, lifetime, sequence numbers |
| OPC 10000-4 §5.14.2 | CreateSubscription | Request/response, revised parameters |
| OPC 10000-4 §5.14.3 | ModifySubscription | Revising an existing subscription |
| OPC 10000-4 §5.14.4 | SetPublishingMode | Enable/disable publishing |
| OPC 10000-4 §5.14.5 | Publish | Notifications, acknowledgements |
| OPC 10000-4 §5.14.6 | Republish | Retrieve unacknowledged message |
| OPC 10000-4 §5.14.7 | DeleteSubscriptions | Cleanup |

Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/5.14

## Implementation

- `packages/server/src/subscription/subscription.ts` — `Subscription` class, publishing timer, sequence numbers, acknowledgement processing.
- `packages/server/src/subscription/subscriptionManager.ts` — owns Subscriptions, indexed by session.
- `packages/server/src/services/subscriptionService.ts` — service dispatcher entry points.
- Session close with `deleteSubscriptions=true` removes all Subscriptions owned by that session.
