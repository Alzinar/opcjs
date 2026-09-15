# Subscription Client Publish Multiple

**Facet**: Base Client Behaviour Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Implementation

- `SubscriptionHandler` (`packages/client/src/subscription/subscriptionHandler.ts`) now runs a configurable pipeline of concurrent `Publish` worker loops (`DEFAULT_PUBLISH_PIPELINE_DEPTH = 2`) instead of gating on a single in-flight request. Each worker immediately issues its next `Publish` request as soon as its previous response arrives, independently of the other workers, so the server always has multiple outstanding Publish requests to answer.
- Acknowledgements are accumulated in a shared, per-session `acknowledgementQueue` and drained onto whichever pipeline worker sends the next request, preserving correct sequencing regardless of which worker's response triggers them.
- A `generation` counter ensures stale workers from a previous pipeline (before a `stop()`/`restartPublishLoop()` cycle) cannot resurrect and duplicate requests.
- Covered by `packages/client/tests/unit/multipleSubscriptions.test.ts` (pipeline depth, immediate re-issue, dedup of `onPublishError`) and the pre-existing `publishLoopReconnect.test.ts`.

## Description

The client must send multiple `Publish` service requests in parallel to ensure the server is always able to send notifications without being blocked by the client.

**Client responsibilities**:
- Maintain a pipeline of outstanding `Publish` requests on the server at all times (typically 2–3 pending requests).
- Send a new `Publish` request immediately upon receiving a `PublishResponse`, so the server always has at least one pending request to respond to.
- Respect the server's `maxNotificationsPerPublish` limit from `CreateSubscriptionResponse`.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.13.5 | Publish Service |
| profiles.opcfoundation.org | [CU 3117](https://profiles.opcfoundation.org/conformanceunit/3117) | Subscription Client Publish Multiple |
