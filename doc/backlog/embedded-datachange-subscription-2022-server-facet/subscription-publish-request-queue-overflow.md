# Subscription PublishRequest Queue Overflow

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> If the maximum supported number of PublishRequests has been queued and a new PublishRequest arrives, the "oldest" PublishRequest has to be discarded by returning the proper error.

Per Part 4 §5.14.5, when a Session has reached its configured limit of pending Publish requests and another arrives, the Server must respond to the oldest queued Publish request with `Bad_TooManyPublishRequests` so the Client can immediately re-issue it.

`PublishRequestQueue` (session-scoped, shared by every Subscription owned by that session) caps the number of parked Publish requests at 10. When a new request would exceed the cap, the oldest parked request is immediately resolved with `Bad_TooManyPublishRequests` before the new one is enqueued.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 §5.14.5 | Publish | Overflow handling |

Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/5.14.5

## Implementation

- `packages/server/src/subscription/publishRequestQueue.ts` — `PublishRequestQueue.enqueue()` evicts and resolves the oldest parked request with `Bad_TooManyPublishRequests` once the cap (`MAX_PENDING_PUBLISH_REQUESTS_PER_SESSION = 10`) is reached.
- Tested in `packages/server/tests/subscription.test.ts` (`Subscription Publish Basic / PublishRequest Queue Overflow`).
