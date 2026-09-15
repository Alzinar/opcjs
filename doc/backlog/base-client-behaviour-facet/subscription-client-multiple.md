# Subscription Client Multiple

**Facet**: Base Client Behaviour Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Implementation

- `SubscriptionHandler.subscribe()` (`packages/client/src/subscription/subscriptionHandler.ts`) no longer throws on a second call — each call creates an independent Subscription (its own server-assigned `subscriptionId`, `publishingInterval`, `priority` via `SubscriptionOptions`) and returns the `subscriptionId`.
- Incoming `PublishResponse` notifications are routed to the correct Subscription's monitored-item entries by matching `subscriptionId`, so each subscription's callbacks only receive its own data.
- All Subscriptions created on a session share the single Publish pipeline (Publish is a per-Session service per OPC UA Part 4 §5.13.5, not per-Subscription) — see [Subscription Client Publish Multiple](./subscription-client-publish-multiple.md) for the pipeline itself.
- Covered by `packages/client/tests/unit/multipleSubscriptions.test.ts`.

## Description

The client must use multiple subscriptions to reduce the payload of individual notifications. Rather than placing all monitored items into a single subscription, the client splits them across multiple subscriptions, each with its own publishing interval and priority.

**Client responsibilities**:
- Create more than one subscription on the same session when different groups of monitored items have different publishing requirements (e.g. fast vs. slow data).
- Select an appropriate `publishingInterval` and `priority` per subscription.
- Handle `PublishResponse` notifications independently for each subscription.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.13.2 | CreateSubscription Service |
| OPC 10000-4 | §5.13.5 | Publish Service |
| profiles.opcfoundation.org | [CU 3071](https://profiles.opcfoundation.org/conformanceunit/3071) | Subscription Client Multiple |
