import {
  DataChangeNotification,
  DiagnosticInfo,
  ExtensionObject,
  type ILogger,
  type NodeId,
  MonitoringModeEnum,
  NotificationMessage,
  PublishResponse,
  ResponseHeader,
  StatusChangeNotification,
  StatusCode,
  StatusCodeToString,
  getLogger,
} from 'opcjs-base'

import { AttributeId } from '../addressSpace/node.js'
import type { IAddressSpace } from '../addressSpace/iAddressSpace.js'
import { makeResponseHeader } from '../services/responseHeader.js'
import { MonitoredItem } from './monitoredItem.js'
import type { PublishRequestQueue } from './publishRequestQueue.js'

/** Default revision bounds for `requestedPublishingInterval` (ms). OPC UA Part 4 §5.14.2. */
const MIN_PUBLISHING_INTERVAL_MS = 50
const MAX_PUBLISHING_INTERVAL_MS = 3_600_000

/** Default bounds for the subscription lifetime counter. */
const MIN_KEEP_ALIVE_COUNT = 1
const MAX_KEEP_ALIVE_COUNT = 0x7fff_ffff
const MIN_LIFETIME_COUNT = 3
const MAX_LIFETIME_COUNT = 0x7fff_ffff

/** Maximum NotificationMessages retained for republish (Part 4 §5.14.5). */
const MAX_RETAINED_NOTIFICATIONS = 16

/**
 * Callback signature used by {@link Subscription} to deliver the response of a
 * waiting `PublishRequest`. The dispatcher returns the response through this
 * callback exactly once.
 */
export type PublishCallback = (response: PublishResponse) => void

/**
 * Server-side state for a single OPC UA Subscription.
 *
 * Implements a simplified — but spec-compliant — variant of the publishing
 * state machine described in Part 4 §5.14.1:
 *
 * ```
 *  every publishingInterval:
 *    sample all monitored items
 *    if notifications are queued AND a publish request is waiting:
 *       send NotificationMessage and reset keep-alive counter
 *    else if keep-alive counter >= maxKeepAliveCount AND a publish request is waiting:
 *       send empty keep-alive NotificationMessage and reset keep-alive counter
 *    else:
 *       increment keep-alive / lifetime counters
 *
 *  if lifetime counter >= lifetimeCount:
 *    fire onExpired() — the manager removes the subscription
 * ```
 *
 * Sampling intervals are revised to `publishingInterval` to keep timer
 * bookkeeping minimal; this is permitted by the spec because the server
 * may revise any client request.
 */
export class Subscription {
  private readonly logger: ILogger
  private readonly monitoredItems = new Map<number, MonitoredItem>()
  /** Retained notification messages for potential Republish requests. */
  private readonly retained: NotificationMessage[] = []
  /** Tick counter since the last NotificationMessage or keep-alive was sent. */
  private keepAliveCounter = 0
  /** Tick counter since the last interaction (PublishRequest or NotificationMessage sent). */
  private lifetimeCounter = 0
  /** Next NotificationMessage sequence number to assign (starts at 1, Part 4 §7.32). */
  private nextSequenceNumber = 1
  /** Next monitored-item ID to assign within this subscription. */
  private nextMonitoredItemId = 1
  /** True once `dispose()` has been called. */
  private disposed = false
  /** Active publishing timer handle. */
  private timer?: ReturnType<typeof setInterval>

  constructor(
    public readonly subscriptionId: number,
    /** authenticationToken of the session that owns this subscription. */
    public readonly ownerAuthToken: string,
    /** Revised publishingInterval (ms). Mutable — {@link modify} may re-arm the timer. */
    public revisedPublishingInterval: number,
    public revisedMaxKeepAliveCount: number,
    public revisedLifetimeCount: number,
    public readonly maxNotificationsPerPublish: number,
    public publishingEnabled: boolean,
    public readonly priority: number,
    /** Session-scoped queue of parked Publish requests, shared with sibling Subscriptions of the same session. */
    private readonly publishQueue: PublishRequestQueue,
    private readonly addressSpace: IAddressSpace,
    /** Invoked when the subscription lifetime expires; the manager removes us. */
    private readonly onExpired: (subscriptionId: number) => void,
  ) {
    this.logger = getLogger(`subscription.${subscriptionId}`)
    this.start()
  }

  /**
   * Starts the publishing timer.  Called from the constructor and not
   * intended to be invoked directly.
   */
  private start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => this.onPublishingTick(), this.revisedPublishingInterval)
    // setInterval keeps the Node event loop alive; unref so server.close() works
    // even with active subscriptions.
    if (typeof (this.timer as { unref?: () => void })?.unref === 'function') {
      ;(this.timer as unknown as { unref: () => void }).unref()
    }
  }

  /** Stops the running publishing timer, if any, so it can be re-armed with a new interval. */
  private stopTimer(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Applies revised parameters from a ModifySubscription request and re-arms
   * the publishing timer so the new `publishingInterval` takes effect
   * immediately (Part 4 §5.14.3.1: "Changes to the Subscription settings
   * shall be applied immediately"). The keep-alive and lifetime counters are
   * reset since they are measured against the (possibly new) interval.
   */
  modify(revised: RevisedSubscriptionParameters): void {
    if (this.disposed) return
    this.revisedPublishingInterval = revised.publishingInterval
    this.revisedMaxKeepAliveCount = revised.maxKeepAliveCount
    this.revisedLifetimeCount = revised.lifetimeCount
    this.keepAliveCounter = 0
    this.lifetimeCounter = 0
    this.stopTimer()
    this.start()
    this.logger.debug(
      `Subscription ${this.subscriptionId} modified (publishingInterval=${revised.publishingInterval}ms)`,
    )
  }

  /**
   * Stops the publishing timer. Idempotent.
   *
   * Does not touch the session-scoped {@link PublishRequestQueue}: sibling
   * Subscriptions of the same session may still be able to serve parked
   * Publish requests. `SubscriptionManager` drains the queue once the last
   * Subscription of a session is removed.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  // ── Monitored item management ──────────────────────────────────────────

  /** Adds a new monitored item and returns the assigned monitoredItemId. */
  addMonitoredItem(item: Omit<MonitoredItemArgs, 'monitoredItemId'>): MonitoredItem {
    const id = this.nextMonitoredItemId++
    const mi = new MonitoredItem(
      id,
      item.nodeId,
      item.attributeId,
      item.clientHandle,
      this.revisedPublishingInterval,
      item.queueSize,
      item.monitoringMode,
      item.indexRange,
    )
    this.monitoredItems.set(id, mi)
    // Sample once immediately so the first publish always carries the initial value.
    mi.sample(this.addressSpace)
    return mi
  }

  /** Removes monitored items by id. Returns a StatusCode per requested id. */
  deleteMonitoredItems(ids: number[]): StatusCode[] {
    return ids.map(id => {
      if (this.monitoredItems.delete(id)) {
        return StatusCode.Good
      }
      return StatusCode.BadMonitoredItemIdInvalid
    })
  }

  /** Returns the monitored item with the given id, if it belongs to this subscription. */
  getMonitoredItem(monitoredItemId: number): MonitoredItem | undefined {
    return this.monitoredItems.get(monitoredItemId)
  }

  /** Revises the queue size of an existing monitored item (`ModifyMonitoredItems`, Part 4 §5.13.3). */
  modifyMonitoredItem(monitoredItemId: number, queueSize: number): StatusCode {
    const mi = this.monitoredItems.get(monitoredItemId)
    if (mi === undefined) return StatusCode.BadMonitoredItemIdInvalid
    mi.modify(queueSize)
    return StatusCode.Good
  }

  /** Sets the monitoring mode of existing monitored items (`SetMonitoringMode`, Part 4 §5.13.4). Returns a StatusCode per requested id. */
  setMonitoringMode(monitoredItemIds: number[], monitoringMode: MonitoringModeEnum): StatusCode[] {
    return monitoredItemIds.map(id => {
      const mi = this.monitoredItems.get(id)
      if (mi === undefined) return StatusCode.BadMonitoredItemIdInvalid
      mi.monitoringMode = monitoringMode
      return StatusCode.Good
    })
  }

  /**
   * Marks every MonitoredItem of this subscription observing the `Value`
   * attribute of `nodeId` so their next reported DataValue carries the
   * `SemanticsChanged` StatusCode bit (Base Info SemanticChange Bit CU).
   */
  notifySemanticChange(nodeId: NodeId): void {
    for (const mi of this.monitoredItems.values()) {
      if (mi.attributeId === AttributeId.Value && mi.nodeId.toString() === nodeId.toString()) {
        mi.markSemanticsChanged()
      }
    }
  }

  /** Yields `{ samplingInterval, monitoringMode }` for every monitored item, for `SamplingIntervalDiagnosticsArray` aggregation. */
  *monitoredItemDiagnostics(): IterableIterator<{ samplingInterval: number; monitoringMode: MonitoringModeEnum }> {
    for (const mi of this.monitoredItems.values()) {
      yield { samplingInterval: mi.revisedSamplingInterval, monitoringMode: mi.monitoringMode }
    }
  }

  /** Number of monitored items currently attached to this subscription. */
  get monitoredItemCount(): number {
    return this.monitoredItems.size
  }

  // ── Publish request handling ──────────────────────────────────────────

  /**
   * Enqueues a Publish request callback.  Acknowledgements are processed
   * immediately to discard retained NotificationMessages.
   *
   * If there are queued notifications they are flushed to the callback
   * synchronously; otherwise the callback is parked on the session-scoped
   * {@link PublishRequestQueue} (Subscription Publish Basic /
   * PublishRequest Queue Overflow CUs).
   */
  enqueuePublishCallback(
    requestHandle: number,
    acknowledged: number[],
    publishCallback: PublishCallback,
  ): void {
    if (this.disposed) {
      publishCallback(this.buildStatusChangeResponse(requestHandle, StatusCode.BadSessionClosed))
      return
    }
    this.processAcknowledgements(acknowledged)
    // Reset lifetime: client is alive.
    this.lifetimeCounter = 0

    // Wrap so we can re-use response building.
    const wrapped: PublishCallback = (response) => {
      // Always echo the originating requestHandle in the response header.
      if (response.responseHeader !== undefined) {
        response.responseHeader.requestHandle = requestHandle
      }
      publishCallback(response)
    }

    if (this.hasPendingNotifications()) {
      this.sendNotificationMessage(wrapped)
    } else {
      this.publishQueue.enqueue(requestHandle, wrapped)
    }
  }

  /** Removes any retained NotificationMessage whose sequenceNumber the client has acknowledged. */
  processAcknowledgements(acknowledged: number[]): void {
    if (acknowledged.length === 0) return
    for (let i = this.retained.length - 1; i >= 0; i--) {
      if (acknowledged.includes(this.retained[i].sequenceNumber)) {
        this.retained.splice(i, 1)
      }
    }
  }

  /**
   * Returns the retained NotificationMessage matching `sequenceNumber`, or
   * `undefined` if it is no longer available (already acknowledged, never
   * sent, or evicted from the retransmission queue). Part 4 §5.14.6.
   */
  republish(sequenceNumber: number): NotificationMessage | undefined {
    return this.retained.find(m => m.sequenceNumber === sequenceNumber)
  }

  // ── Publishing tick (the heart of the subscription) ───────────────────

  private onPublishingTick(): void {
    if (this.disposed) return

    if (this.publishingEnabled) {
      let anyChanged = false
      for (const mi of this.monitoredItems.values()) {
        if (mi.sample(this.addressSpace)) anyChanged = true
      }
      if (anyChanged && !this.publishQueue.isEmpty) {
        const cb = this.publishQueue.dequeue()!
        this.sendNotificationMessage(cb)
        return
      }
    }

    this.keepAliveCounter += 1
    this.lifetimeCounter += 1

    // Send keep-alive when allowed AND a publish request is waiting.
    if (this.keepAliveCounter >= this.revisedMaxKeepAliveCount && !this.publishQueue.isEmpty) {
      const cb = this.publishQueue.dequeue()!
      this.sendKeepAlive(cb)
      this.keepAliveCounter = 0
    }

    if (this.lifetimeCounter >= this.revisedLifetimeCount) {
      this.logger.warn(
        `Subscription ${this.subscriptionId} lifetime expired — sending StatusChangeNotification`,
      )
      // Notify any waiting client of the expiry, then ask the manager to drop us.
      const cb = this.publishQueue.dequeue()
      if (cb !== undefined) {
        cb(this.buildStatusChangeResponse(0, StatusCode.BadTimeout))
      }
      this.onExpired(this.subscriptionId)
    }
  }

  // ── Response construction helpers ─────────────────────────────────────

  private hasPendingNotifications(): boolean {
    if (!this.publishingEnabled) return false
    for (const mi of this.monitoredItems.values()) {
      if (mi.hasPendingNotifications()) return true
    }
    return false
  }

  private sendNotificationMessage(publishCallback: PublishCallback): void {
    const dcn = new DataChangeNotification()
    dcn.monitoredItems = []
    dcn.diagnosticInfos = []
    let count = 0
    outer: for (const mi of this.monitoredItems.values()) {
      const notifications = mi.drainNotifications()
      for (const n of notifications) {
        dcn.monitoredItems.push(n)
        count += 1
        if (count >= this.maxNotificationsPerPublish) break outer
      }
    }

    const msg = new NotificationMessage()
    msg.sequenceNumber = this.nextSequenceNumber++
    msg.publishTime = new Date()
    msg.notificationData = [ExtensionObject.newBinary(dcn)]

    this.retainNotification(msg)
    this.keepAliveCounter = 0
    this.lifetimeCounter = 0

    publishCallback(this.buildPublishResponse(msg))
    this.logger.debug(
      `Sent NotificationMessage seq=${msg.sequenceNumber} items=${count}`,
    )
  }

  private sendKeepAlive(publishCallback: PublishCallback): void {
    const msg = new NotificationMessage()
    msg.sequenceNumber = this.nextSequenceNumber  // Keep-alive re-uses next seq (not yet assigned).
    msg.publishTime = new Date()
    msg.notificationData = []
    // Keep-alive messages MUST NOT consume a sequence number and MUST NOT be retained.
    publishCallback(this.buildPublishResponse(msg))
    this.logger.debug(`Sent keep-alive on subscription ${this.subscriptionId}`)
  }

  private buildPublishResponse(message: NotificationMessage): PublishResponse {
    const response = new PublishResponse()
    response.responseHeader = makeResponseHeader(0)
    response.subscriptionId = this.subscriptionId
    response.availableSequenceNumbers = this.retained.map(m => m.sequenceNumber)
    response.moreNotifications = this.hasPendingNotifications()
    response.notificationMessage = message
    response.results = []
    response.diagnosticInfos = []
    return response
  }

  private buildStatusChangeResponse(
    requestHandle: number,
    status: StatusCode,
  ): PublishResponse {
    const scn = new StatusChangeNotification()
    scn.status = status
    scn.diagnosticInfo = new DiagnosticInfo()

    const msg = new NotificationMessage()
    msg.sequenceNumber = this.nextSequenceNumber++
    msg.publishTime = new Date()
    msg.notificationData = [ExtensionObject.newBinary(scn)]

    const response = new PublishResponse()
    const header: ResponseHeader = makeResponseHeader(requestHandle)
    response.responseHeader = header
    response.subscriptionId = this.subscriptionId
    response.availableSequenceNumbers = []
    response.moreNotifications = false
    response.notificationMessage = msg
    response.results = []
    response.diagnosticInfos = []
    this.logger.debug(
      `Sent StatusChangeNotification ${StatusCodeToString(status)} on subscription ${this.subscriptionId}`,
    )
    return response
  }

  private retainNotification(msg: NotificationMessage): void {
    this.retained.push(msg)
    if (this.retained.length > MAX_RETAINED_NOTIFICATIONS) {
      this.retained.shift()
    }
  }
}

/** Parameters used to construct a new {@link MonitoredItem} via {@link Subscription.addMonitoredItem}. */
export type MonitoredItemArgs = {
  monitoredItemId: number
  nodeId: import('opcjs-base').NodeId
  attributeId: number
  clientHandle: number
  queueSize: number
  monitoringMode: import('opcjs-base').MonitoringModeEnum
  /** `IndexRange` (Part 4 §7.27) selecting a subset of the sampled value, or `undefined` for the whole value. */
  indexRange?: string
}

/** Result of {@link reviseSubscriptionParameters}. */
export type RevisedSubscriptionParameters = {
  publishingInterval: number
  maxKeepAliveCount: number
  lifetimeCount: number
}

/**
 * Revises the requested subscription parameters using simple but spec-compliant bounds
 * (Part 4 §5.14.2 — Server may revise any value the client requests).
 *
 * Rules:
 *  - Clamp publishingInterval into [{@link MIN_PUBLISHING_INTERVAL_MS}, {@link MAX_PUBLISHING_INTERVAL_MS}].
 *  - Clamp maxKeepAliveCount and lifetimeCount into safe positive bounds.
 *  - Ensure lifetimeCount >= 3 × maxKeepAliveCount (Part 4 §5.14.2.4).
 */
export function reviseSubscriptionParameters(args: {
  publishingInterval: number
  maxKeepAliveCount: number
  lifetimeCount: number
}): RevisedSubscriptionParameters {
  const publishingInterval = clamp(
    isFinite(args.publishingInterval) && args.publishingInterval > 0
      ? args.publishingInterval
      : 1000,
    MIN_PUBLISHING_INTERVAL_MS, // todo: should be passed by configuration
    MAX_PUBLISHING_INTERVAL_MS,
  )
  const maxKeepAliveCount = clamp(
    args.maxKeepAliveCount > 0 ? args.maxKeepAliveCount : 10,
    MIN_KEEP_ALIVE_COUNT,
    MAX_KEEP_ALIVE_COUNT,
  )
  const minLifetime = 3 * maxKeepAliveCount
  const lifetimeCount = clamp(
    Math.max(args.lifetimeCount, minLifetime),
    Math.max(MIN_LIFETIME_COUNT, minLifetime),
    MAX_LIFETIME_COUNT,
  )
  return { publishingInterval, maxKeepAliveCount, lifetimeCount }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
