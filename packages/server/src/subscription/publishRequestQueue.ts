import { NotificationMessage, PublishResponse, StatusCode } from 'opcjs-base'

import { makeResponseHeader } from '../services/responseHeader.js'
import type { PublishCallback } from './subscription.js'

/**
 * Maximum number of Publish requests a single Session may park before the
 * oldest is discarded with `Bad_TooManyPublishRequests` (OPC UA Part 4
 * §5.14.5 — Subscription PublishRequest Queue Overflow CU). Chosen well
 * above the Embedded facet's recommended minimum of 2 so normal operation
 * never hits the limit.
 */
const MAX_PENDING_PUBLISH_REQUESTS_PER_SESSION = 10

type QueuedPublish = {
  readonly requestHandle: number
  readonly resolve: PublishCallback
}

/**
 * Session-scoped FIFO queue of parked Publish requests.
 *
 * Shared by every {@link Subscription} owned by the same Session (one
 * instance per session, created by {@link SubscriptionManager}) so that any
 * ready Subscription can serve any pending Publish request — Publish
 * requests belong to the Session, not to an individual Subscription (Part 4
 * §5.14.5).
 */
export class PublishRequestQueue {
  private readonly pending: QueuedPublish[] = []

  /** True when no Publish request is currently parked. */
  get isEmpty(): boolean {
    return this.pending.length === 0
  }

  /**
   * Parks a Publish request. If the session already has
   * {@link MAX_PENDING_PUBLISH_REQUESTS_PER_SESSION} requests queued, the
   * oldest is immediately resolved with `Bad_TooManyPublishRequests`
   * (Subscription PublishRequest Queue Overflow CU).
   */
  enqueue(requestHandle: number, resolve: PublishCallback): void {
    if (this.pending.length >= MAX_PENDING_PUBLISH_REQUESTS_PER_SESSION) {
      const oldest = this.pending.shift()!
      oldest.resolve(buildImmediateResponse(oldest.requestHandle, StatusCode.BadTooManyPublishRequests))
    }
    this.pending.push({ requestHandle, resolve })
  }

  /** Removes and returns the oldest parked request's callback, or `undefined` if none is parked. */
  dequeue(): PublishCallback | undefined {
    return this.pending.shift()?.resolve
  }

  /** Removes and resolves every parked request with `statusCode` (used when a session's last Subscription is removed). */
  drain(statusCode: StatusCode): void {
    const all = this.pending.splice(0)
    for (const p of all) p.resolve(buildImmediateResponse(p.requestHandle, statusCode))
  }
}

/** Builds an immediate-error `PublishResponse` (no notification, just a serviceResult). */
function buildImmediateResponse(requestHandle: number, statusCode: StatusCode): PublishResponse {
  const response = new PublishResponse()
  response.responseHeader = makeResponseHeader(requestHandle, statusCode)
  response.subscriptionId = 0
  response.availableSequenceNumbers = []
  response.moreNotifications = false
  // Always populate notificationMessage — the binary encoder dereferences it
  // unconditionally even on error responses.
  const empty = new NotificationMessage()
  empty.sequenceNumber = 0
  empty.publishTime = new Date()
  empty.notificationData = []
  response.notificationMessage = empty
  response.results = []
  response.diagnosticInfos = []
  return response
}
