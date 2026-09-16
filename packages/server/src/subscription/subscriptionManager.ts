import {
  type ILogger,
  type NodeId,
  MonitoringModeEnum,
  SamplingIntervalDiagnosticsDataType,
  StatusCode,
  getLogger,
} from 'opcjs-base'

import type { IAddressSpace } from '../addressSpace/iAddressSpace.js'
import { PublishRequestQueue } from './publishRequestQueue.js'
import { Subscription, reviseSubscriptionParameters } from './subscription.js'

/**
 * Owns all live {@link Subscription} instances of a server.
 *
 * Subscriptions are keyed by `subscriptionId` and also indexed by the
 * authentication-token of the owning session so they can be removed when a
 * session is closed (Part 4 §5.6.4 CloseSession with `deleteSubscriptions=true`).
 */
export class SubscriptionManager {
  private readonly logger: ILogger
  private readonly subscriptions = new Map<number, Subscription>()
  /** authToken.toString() → set of subscriptionIds owned by that session. */
  private readonly bySession = new Map<string, Set<number>>()
  /** authToken.toString() → the session's shared Publish-request queue (Part 4 §5.14.5). */
  private readonly publishQueues = new Map<string, PublishRequestQueue>()
  /** Monotonically increasing subscriptionId counter. */
  private nextSubscriptionId = 1

  constructor(private readonly addressSpace: IAddressSpace) {
    this.logger = getLogger('subscription.SubscriptionManager')
  }

  /**
   * Creates a new subscription owned by the given session.
   *
   * The requested parameters are revised by {@link reviseSubscriptionParameters}.
   */
  createSubscription(args: {
    ownerAuthToken: NodeId
    requestedPublishingInterval: number
    requestedMaxKeepAliveCount: number
    requestedLifetimeCount: number
    maxNotificationsPerPublish: number
    publishingEnabled: boolean
    priority: number
  }): Subscription {
    const revised = reviseSubscriptionParameters({
      publishingInterval: args.requestedPublishingInterval,
      maxKeepAliveCount: args.requestedMaxKeepAliveCount,
      lifetimeCount: args.requestedLifetimeCount,
    })

    const subscriptionId = this.nextSubscriptionId++
    const tokenKey = args.ownerAuthToken.toString()

    let publishQueue = this.publishQueues.get(tokenKey)
    if (publishQueue === undefined) {
      publishQueue = new PublishRequestQueue()
      this.publishQueues.set(tokenKey, publishQueue)
    }

    const subscription = new Subscription(
      subscriptionId,
      tokenKey,
      revised.publishingInterval,
      revised.maxKeepAliveCount,
      revised.lifetimeCount,
      args.maxNotificationsPerPublish > 0 ? args.maxNotificationsPerPublish : 1000,
      args.publishingEnabled,
      args.priority,
      publishQueue,
      this.addressSpace,
      id => this.deleteSubscription(id),
    )

    this.subscriptions.set(subscriptionId, subscription)
    let owned = this.bySession.get(tokenKey)
    if (owned === undefined) {
      owned = new Set()
      this.bySession.set(tokenKey, owned)
    }
    owned.add(subscriptionId)

    this.logger.debug(
      `Subscription ${subscriptionId} created (publishingInterval=${revised.publishingInterval}ms)`,
    )
    return subscription
  }

  /** Returns the subscription, or undefined if not found. */
  get(subscriptionId: number): Subscription | undefined {
    return this.subscriptions.get(subscriptionId)
  }

  /**
   * Returns the subscription if it exists and belongs to the given session.
   * Returns undefined otherwise (the caller must convert to the appropriate
   * service-result StatusCode).
   */
  getOwned(subscriptionId: number, ownerAuthToken: NodeId): Subscription | undefined {
    const sub = this.subscriptions.get(subscriptionId)
    if (sub === undefined) return undefined
    if (sub.ownerAuthToken !== ownerAuthToken.toString()) return undefined
    return sub
  }

  /**
   * Deletes one subscription, releases its resources, and unlinks it from the
   * owning session. When this was the session's last Subscription, any
   * Publish requests still parked on the session's queue are resolved with
   * `Bad_NoSubscription` and the queue is discarded.  Idempotent.
   */
  deleteSubscription(subscriptionId: number): StatusCode {
    const sub = this.subscriptions.get(subscriptionId)
    if (sub === undefined) return StatusCode.BadSubscriptionIdInvalid
    sub.dispose()
    this.subscriptions.delete(subscriptionId)
    const owned = this.bySession.get(sub.ownerAuthToken)
    if (owned !== undefined) {
      owned.delete(subscriptionId)
      if (owned.size === 0) {
        this.bySession.delete(sub.ownerAuthToken)
        this.publishQueues.get(sub.ownerAuthToken)?.drain(StatusCode.BadNoSubscription)
        this.publishQueues.delete(sub.ownerAuthToken)
      }
    }
    this.logger.debug(`Subscription ${subscriptionId} deleted`)
    return StatusCode.Good
  }

  /**
   * Deletes every subscription owned by the given session.  Invoked from the
   * session-close path so terminated sessions don't leak subscriptions.
   */
  deleteSubscriptionsOfSession(authToken: NodeId): void {
    const tokenKey = authToken.toString()
    const owned = this.bySession.get(tokenKey)
    if (owned === undefined) return
    for (const id of [...owned]) {
      this.deleteSubscription(id)
    }
  }

  /** Iterates every live subscription owned by the given session. */
  forEachOwned(authToken: NodeId, cb: (sub: Subscription) => void): void {
    const owned = this.bySession.get(authToken.toString())
    if (owned === undefined) return
    for (const id of owned) {
      const sub = this.subscriptions.get(id)
      if (sub !== undefined) cb(sub)
    }
  }

  /** Disposes all subscriptions (server shutdown). */
  disposeAll(): void {
    for (const sub of this.subscriptions.values()) {
      sub.dispose()
    }
    for (const queue of this.publishQueues.values()) {
      queue.drain(StatusCode.BadSessionClosed)
    }
    this.subscriptions.clear()
    this.bySession.clear()
    this.publishQueues.clear()
  }

  /**
   * Marks every MonitoredItem (of any Subscription) observing the `Value`
   * attribute of `nodeId` so their next reported DataValue carries the
   * `SemanticsChanged` StatusCode bit (Base Info SemanticChange Bit CU).
   */
  notifySemanticChange(nodeId: NodeId): void {
    for (const sub of this.subscriptions.values()) {
      sub.notifySemanticChange(nodeId)
    }
  }

  /**
   * Aggregates the sampling interval in use by every live, non-disabled
   * MonitoredItem across every Subscription, for the
   * `SamplingIntervalDiagnosticsArray` (Base Info Fixed SamplingInterval CU).
   */
  getSamplingIntervalDiagnostics(): SamplingIntervalDiagnosticsDataType[] {
    const byInterval = new Map<number, { monitoredItemCount: number; disabledMonitoredItemCount: number }>()
    for (const sub of this.subscriptions.values()) {
      for (const { samplingInterval, monitoringMode } of sub.monitoredItemDiagnostics()) {
        let entry = byInterval.get(samplingInterval)
        if (entry === undefined) {
          entry = { monitoredItemCount: 0, disabledMonitoredItemCount: 0 }
          byInterval.set(samplingInterval, entry)
        }
        entry.monitoredItemCount += 1
        if (monitoringMode === MonitoringModeEnum.Disabled) {
          entry.disabledMonitoredItemCount += 1
        }
      }
    }

    return [...byInterval.entries()].map(([samplingInterval, entry]) => {
      const diag = new SamplingIntervalDiagnosticsDataType()
      diag.samplingInterval = samplingInterval
      diag.monitoredItemCount = entry.monitoredItemCount
      diag.maxMonitoredItemCount = entry.monitoredItemCount
      diag.disabledMonitoredItemCount = entry.disabledMonitoredItemCount
      return diag
    })
  }

  /** Test/observability helper: number of live subscriptions. */
  get count(): number {
    return this.subscriptions.size
  }
}
