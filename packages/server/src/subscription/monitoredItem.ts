import {
  type NodeId,
  DataValue,
  MonitoredItemNotification,
  MonitoringModeEnum,
  StatusCode,
} from 'opcjs-base'

import type { IAddressSpace } from '../addressSpace/iAddressSpace.js'
import { applyIndexRange } from '../services/indexRangeUtil.js'

/** Bit 14 of a StatusCode: the semantics (engineering unit, definition, ...) of the variable changed (OPC UA Part 4 §7.39). */
const SEMANTICS_CHANGED_BIT = 0x4000

/**
 * Upper bound on `revisedQueueSize` (Base Info Server Capabilities
 * MaxMonitoredItemsQueueSize CU). Mirrored by the
 * `ServerCapabilities/MaxMonitoredItemsQueueSize` address-space node so
 * clients can discover the limit.
 */
export const MAX_MONITORED_ITEMS_QUEUE_SIZE = 100

/**
 * Server-side state for a single monitored item belonging to a {@link Subscription}.
 *
 * The server samples the underlying address-space attribute on each publishing
 * tick (sampling interval is revised to the subscription's publishing interval
 * in this simplified implementation, OPC UA Part 4 §5.13).
 *
 * When the sampled `DataValue` differs from the previously-reported value the
 * new value is queued for the next `PublishResponse` as a
 * {@link MonitoredItemNotification}.
 *
 * @see OPC UA Part 4 §5.13 Monitored Items Service Set
 */
export class MonitoredItem {
  /** Last sampled DataValue we successfully queued for reporting (used for change detection). */
  private lastReportedValue: DataValue | undefined

  /** Queued notifications awaiting the next publishing tick. */
  private readonly queue: MonitoredItemNotification[] = []

  /** Set by {@link Subscription.notifySemanticChange}; consumed on the next {@link sample}. */
  private semanticsChangedPending = false

  constructor(
    public readonly monitoredItemId: number,
    public readonly nodeId: NodeId,
    public readonly attributeId: number,
    public readonly clientHandle: number,
    /** Revised sampling interval in milliseconds (always == subscription publishing interval here). */
    public readonly revisedSamplingInterval: number,
    /** Maximum number of values that may be queued. Mutable via {@link modify}. */
    public revisedQueueSize: number,
    public monitoringMode: MonitoringModeEnum,
    /** `IndexRange` (Part 4 §7.27) selecting a subset of the sampled value, or `undefined` for the whole value. */
    public readonly indexRange?: string,
  ) {}

  /** Revises `revisedQueueSize` in response to a `ModifyMonitoredItems` request. */
  modify(queueSize: number): void {
    this.revisedQueueSize = queueSize
    // Trim the existing queue if it now exceeds the new (smaller) size.
    while (this.queue.length > this.revisedQueueSize) {
      this.queue.shift()
    }
  }

  /**
   * Marks that a semantic property of the monitored Variable changed; the
   * next sampled value will have the `SemanticsChanged` StatusCode bit set
   * and will be reported even if the value itself is unchanged (Part 4 §7.39).
   */
  markSemanticsChanged(): void {
    this.semanticsChangedPending = true
  }

  /**
   * Sample the underlying address-space value.
   *
   * - When the monitoring mode is `Disabled` no sampling occurs.
   * - When the value changed compared to the previously reported value a new
   *   {@link MonitoredItemNotification} is appended to the queue. In `Sampling`
   *   mode the value is recorded but not added to the report queue (per spec).
   *
   * Returns `true` when a new notification was queued (i.e. should be sent in
   * the next PublishResponse).
   */
  sample(addressSpace: IAddressSpace): boolean {
    if (this.monitoringMode === MonitoringModeEnum.Disabled) {
      return false
    }

    const dataValue = applyIndexRange(addressSpace.read(this.nodeId, this.attributeId), this.indexRange)

    const semanticsChanged = this.semanticsChangedPending
    if (!this.hasChanged(dataValue) && !semanticsChanged) {
      return false
    }

    this.lastReportedValue = dataValue

    if (this.monitoringMode !== MonitoringModeEnum.Reporting) {
      // Sampling mode tracks values but does not report them (Part 4 §5.12.2).
      this.semanticsChangedPending = false
      return false
    }

    const notification = new MonitoredItemNotification()
    notification.clientHandle = this.clientHandle
    notification.value = semanticsChanged
      ? new DataValue(
          dataValue.value,
          (dataValue.statusCode ?? StatusCode.Good) | SEMANTICS_CHANGED_BIT,
          dataValue.sourceTimestamp,
          dataValue.serverTimestamp,
          dataValue.sourcePicoseconds,
          dataValue.serverPicoseconds,
        )
      : dataValue
    this.semanticsChangedPending = false

    if (this.queue.length >= this.revisedQueueSize) {
      // Drop oldest (simplified: queueSize=1 in practice for most tests).
      this.queue.shift()
    }
    this.queue.push(notification)
    return true
  }

  /** Drains and returns all queued notifications. */
  drainNotifications(): MonitoredItemNotification[] {
    const out = this.queue.slice()
    this.queue.length = 0
    return out
  }

  /** True if at least one notification is queued for reporting. */
  hasPendingNotifications(): boolean {
    return this.queue.length > 0
  }

  private hasChanged(next: DataValue): boolean {
    const prev = this.lastReportedValue
    if (prev === undefined) {
      return true
    }
    if ((prev.statusCode ?? StatusCode.Good) !== (next.statusCode ?? StatusCode.Good)) {
      return true
    }
    // Variant.equals uses JSON comparison; sufficient for primitive and array values.
    const prevVar = prev.value
    const nextVar = next.value
    if (prevVar === undefined && nextVar === undefined) return false
    if (prevVar === undefined || nextVar === undefined) return true
    return !prevVar.equals(nextVar)
  }
}
