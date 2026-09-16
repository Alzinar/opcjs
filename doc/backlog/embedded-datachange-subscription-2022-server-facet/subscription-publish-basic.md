# Subscription Publish Basic

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Support at least 2 Publish Service requests per Session.

Publish requests are parked on a session-scoped `PublishRequestQueue` (`packages/server/src/subscription/publishRequestQueue.ts`), shared by every Subscription owned by the same session, rather than being bound to a single Subscription. Any number of Publish requests (up to the queue cap — see [subscription-publish-request-queue-overflow.md](./subscription-publish-request-queue-overflow.md)) may be parked concurrently and are served FIFO as notifications or keep-alives become available on any owned Subscription.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 §5.14.5 | Publish | Service definition |
| OPC 10000-4 §5.14.1.3 | Publish request queue | Recommended depth |

Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/5.14.5

## Implementation

- `packages/server/src/subscription/publishRequestQueue.ts` — `PublishRequestQueue`, one instance per session, created lazily by `SubscriptionManager.createSubscription` and shared across all of that session's Subscriptions.
- `packages/server/src/subscription/subscription.ts` — `enqueuePublishCallback` parks on the session's shared queue when no notification is immediately available; `onPublishingTick` dequeues from it to deliver notifications/keep-alives.
- `packages/server/src/services/subscriptionService.ts` — for each Publish request, picks the highest-priority owned Subscription and enqueues the callback there (any owned Subscription may still serve it once parked).
