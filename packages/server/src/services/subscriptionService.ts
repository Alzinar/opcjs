import {
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  DeleteSubscriptionsRequest,
  DeleteSubscriptionsResponse,
  type ILogger,
  ModifySubscriptionRequest,
  ModifySubscriptionResponse,
  type NodeId,
  NotificationMessage,
  PublishRequest,
  PublishResponse,
  RepublishRequest,
  RepublishResponse,
  SetPublishingModeRequest,
  SetPublishingModeResponse,
  StatusCode,
  getLogger,
} from 'opcjs-base'

import type { Session } from '../sessions/session.js'
import type { SubscriptionManager } from '../subscription/subscriptionManager.js'
import { reviseSubscriptionParameters } from '../subscription/subscription.js'
import { makeResponseHeader } from './responseHeader.js'

/**
 * Handles the OPC UA Subscription Service Set (Part 4 §5.14):
 *  - CreateSubscription
 *  - ModifySubscription
 *  - DeleteSubscriptions
 *  - SetPublishingMode
 *  - Publish  (long-poll; returns a Promise that resolves when the server has
 *    a notification or keep-alive to send)
 *  - Republish (returns a retained NotificationMessage or `Bad_MessageNotAvailable`)
 *
 * The service does not touch transport — all responses are returned to the
 * dispatcher which forwards them through the secure channel.
 */
export class SubscriptionService {
  private readonly logger: ILogger

  constructor(private readonly subscriptionManager: SubscriptionManager) {
    this.logger = getLogger('services.SubscriptionService')
  }

  // ── CreateSubscription ────────────────────────────────────────────────

  createSubscription(
    request: CreateSubscriptionRequest,
    session: Session,
  ): CreateSubscriptionResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const subscription = this.subscriptionManager.createSubscription({
      ownerAuthToken: session.authenticationToken,
      requestedPublishingInterval: request.requestedPublishingInterval,
      requestedMaxKeepAliveCount: request.requestedMaxKeepAliveCount,
      requestedLifetimeCount: request.requestedLifetimeCount,
      maxNotificationsPerPublish: request.maxNotificationsPerPublish,
      publishingEnabled: request.publishingEnabled,
      priority: request.priority ?? 0,
    })

    const response = new CreateSubscriptionResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.subscriptionId = subscription.subscriptionId
    response.revisedPublishingInterval = subscription.revisedPublishingInterval
    response.revisedLifetimeCount = subscription.revisedLifetimeCount
    response.revisedMaxKeepAliveCount = subscription.revisedMaxKeepAliveCount

    this.logger.debug(
      `Created subscription ${subscription.subscriptionId} for session ${session.sessionId.toString()}`,
    )
    return response
  }

  // ── ModifySubscription ────────────────────────────────────────────────

  /**
   * Revises the requested parameters and re-arms the subscription's
   * publishing timer so the change takes effect immediately (Part 4
   * §5.14.3.1). Returns `Bad_SubscriptionIdInvalid` for unknown ids.
   */
  modifySubscription(
    request: ModifySubscriptionRequest,
    authToken: NodeId,
  ): ModifySubscriptionResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const sub = this.subscriptionManager.getOwned(request.subscriptionId, authToken)
    const response = new ModifySubscriptionResponse()

    if (sub === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadSubscriptionIdInvalid,
      )
      return response
    }

    const revised = reviseSubscriptionParameters({
      publishingInterval: request.requestedPublishingInterval,
      maxKeepAliveCount: request.requestedMaxKeepAliveCount,
      lifetimeCount: request.requestedLifetimeCount,
    })
    sub.modify(revised)
    response.responseHeader = makeResponseHeader(requestHandle)
    response.revisedPublishingInterval = revised.publishingInterval
    response.revisedLifetimeCount = revised.lifetimeCount
    response.revisedMaxKeepAliveCount = revised.maxKeepAliveCount
    return response
  }

  // ── DeleteSubscriptions ───────────────────────────────────────────────

  deleteSubscriptions(
    request: DeleteSubscriptionsRequest,
    authToken: NodeId,
  ): DeleteSubscriptionsResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const ids = request.subscriptionIds ?? []
    const results = ids.map(id => {
      const sub = this.subscriptionManager.getOwned(id, authToken)
      if (sub === undefined) return StatusCode.BadSubscriptionIdInvalid
      return this.subscriptionManager.deleteSubscription(id)
    })

    const response = new DeleteSubscriptionsResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = []
    return response
  }

  // ── SetPublishingMode ─────────────────────────────────────────────────

  setPublishingMode(
    request: SetPublishingModeRequest,
    authToken: NodeId,
  ): SetPublishingModeResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const ids = request.subscriptionIds ?? []
    const enabled = request.publishingEnabled
    const results = ids.map(id => {
      const sub = this.subscriptionManager.getOwned(id, authToken)
      if (sub === undefined) return StatusCode.BadSubscriptionIdInvalid
      sub.publishingEnabled = enabled
      return StatusCode.Good
    })

    const response = new SetPublishingModeResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = []
    return response
  }

  // ── Publish (long-poll) ───────────────────────────────────────────────

  /**
   * Returns a Promise that resolves with the `PublishResponse` once the server
   * has a notification or keep-alive to send for any subscription owned by
   * `authToken`.
   *
   * If the session owns no subscriptions, `Bad_NoSubscription` is returned
   * immediately (Part 4 §5.14.5).
   *
   * Acknowledgements in the request are routed to the matching subscription
   * before queueing.
   */
  publish(request: PublishRequest, authToken: NodeId): Promise<PublishResponse> {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const acks = request.subscriptionAcknowledgements ?? []

    // Group acknowledgements by subscriptionId for routing.
    const acksBySubscription = new Map<number, number[]>()
    const ackResults: StatusCode[] = []
    for (const ack of acks) {
      const list = acksBySubscription.get(ack.subscriptionId)
      if (list === undefined) acksBySubscription.set(ack.subscriptionId, [ack.sequenceNumber])
      else list.push(ack.sequenceNumber)
      // Mark every ack as Good unconditionally — Bad_SequenceNumberUnknown is
      // not surfaced separately by this simplified implementation.
      ackResults.push(StatusCode.Good)
    }

    // Find subscriptions owned by this session.
    return new Promise<PublishResponse>(resolve => {
      // Process acks first — they affect retained NotificationMessages and
      // must not be lost just because the publish ends up targeting a
      // different subscription.
      for (const [subId, seqNums] of acksBySubscription) {
        const sub = this.subscriptionManager.getOwned(subId, authToken)
        if (sub === undefined) continue
        sub.processAcknowledgements(seqNums)
      }

      // Pick a subscription to enqueue the publish callback on.
      const owned = this.findOwnedSubscriptions(authToken)
      if (owned.length === 0) {
        const response = new PublishResponse()
        response.responseHeader = makeResponseHeader(
          requestHandle,
          StatusCode.BadNoSubscription,
        )
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
        response.results = ackResults
        response.diagnosticInfos = []
        resolve(response)
        return
      }

      // Pick highest-priority subscription (tie-break: lowest id).
      owned.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority
        return a.subscriptionId - b.subscriptionId
      })
      const target = owned[0]

      target.enqueuePublishCallback(requestHandle, [], response => {
        // Surface the per-ack results to the client.
        response.results = ackResults
        resolve(response)
      })
    })
  }

  // ── Republish ─────────────────────────────────────────────────────────

  /**
   * Returns the retained NotificationMessage identified by
   * `retransmitSequenceNumber` from the subscription's retransmission queue
   * (Part 4 §5.14.6). Returns `Bad_SubscriptionIdInvalid` if the subscription
   * is unknown or not owned by this session, and `Bad_MessageNotAvailable` if
   * the message has already been discarded or acknowledged.
   */
  republish(request: RepublishRequest, authToken: NodeId): RepublishResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const response = new RepublishResponse()
    const sub = this.subscriptionManager.getOwned(request.subscriptionId, authToken)
    if (sub === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadSubscriptionIdInvalid,
      )
      return response
    }

    const message = sub.republish(request.retransmitSequenceNumber)
    if (message === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadMessageNotAvailable,
      )
      return response
    }

    response.responseHeader = makeResponseHeader(requestHandle)
    response.notificationMessage = message
    return response
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private findOwnedSubscriptions(
    authToken: NodeId,
  ): import('../subscription/subscription.js').Subscription[] {
    const result: import('../subscription/subscription.js').Subscription[] = []
    this.subscriptionManager.forEachOwned(authToken, s => result.push(s))
    return result
  }
}
