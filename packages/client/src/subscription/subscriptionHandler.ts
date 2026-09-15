import {
    ChannelClosedError,
    DataChangeNotification,
    ExpandedNodeId,
    getLogger,
    NodeId,
    PublishResponse,
    StatusChangeNotification,
    StatusCode,
    SubscriptionAcknowledgement,
} from 'opcjs-base'

import { MonitoredItemService } from '../services/monitoredItemService'
import { SubscriptionService } from '../services/subscriptionService'
import { SubscriptionOptions } from "./subscriptionOptions"
import { SubscriptionHandlerEntry } from './subscriptionHandlerEntry'

// OPC UA Part 4, §5.14 — Subscriptions and Monitored Items

/** Node type IDs for notification payloads (OPC UA Part 4, §7.21) */
const NODE_ID_DATA_CHANGE_NOTIFICATION = 811
const NODE_ID_STATUS_CHANGE_NOTIFICATION = 818

/**
 * Default number of `Publish` requests kept outstanding on the server at all times
 * (Subscription Client Publish Multiple conformance unit — OPC UA Part 4, §5.13.5).
 */
const DEFAULT_PUBLISH_PIPELINE_DEPTH = 2

export class SubscriptionHandler {
    private logger = getLogger('SubscriptionHandler')
    private entries = new Array<SubscriptionHandlerEntry>()
    private nextHandle = 0
    private isRunning = false
    /**
     * Acknowledgements for notifications received but not yet confirmed to the server.
     * Drained (and cleared) by the next outgoing Publish request, regardless of which
     * pipeline worker sends it — Publish is a per-Session service, not per-Subscription
     * (Subscription Client Multiple conformance unit).
     */
    private acknowledgementQueue: SubscriptionAcknowledgement[] = []
    /**
     * Incremented every time the publish pipeline (re)starts. Pipeline workers capture
     * their starting generation and stop looping once it no longer matches, so stale
     * workers from a previous run (e.g. before a `stop()` + `restartPublishLoop()` cycle)
     * cannot resurrect and duplicate the pipeline.
     */
    private generation = 0

    /**
     * Optional callback invoked when the server announces a shutdown via a
     * `StatusChangeNotification` with status `BadShutdown` or `BadServerHalted`
     * (OPC UA Part 4, §5.13.6.2 — Session Client Detect Shutdown).
     *
     * Assign this before calling `subscribe()`.  The client sets it automatically
     * in `initServices()` to trigger a reconnect.
     */
    onShutdown?: () => void

    /**
     * Optional callback invoked when a Publish request fails with a transport or
     * service-level error (e.g. `Bad_NoCommunication`).
     *
     * When fired the publish loop has already stopped.  The client sets this
     * automatically in `initServices()` to trigger a reconnect and loop restart.
     */
    onPublishError?: () => void

    /** Returns true when at least one subscription is active and the publish loop is running. */
    hasActiveSubscription(): boolean {
        return this.isRunning && this.entries.length > 0
    }

    /** Returns true when there are registered subscription entries (even if the loop is not running). */
    hasEntries(): boolean {
        return this.entries.length > 0
    }

    /**
     * Stops the publish pipeline and detaches the reconnect callbacks.
     *
     * Call this during an explicit `Client.disconnect()`, before tearing down the
     * channel: closing the channel now rejects any in-flight Publish request, and
     * without this the resulting `onPublishError` would trigger an unwanted
     * auto-reconnect right after the application asked to disconnect.
     */
    stop(): void {
        this.isRunning = false
        this.generation++
        this.onShutdown = undefined
        this.onPublishError = undefined
    }

    /**
     * Replaces the underlying OPC UA service instances after a channel/session reconnect.
     * Call this when the secure channel has been re-established but the subscription
     * entries (callbacks, node IDs, server-side IDs) should be preserved.
     */
    updateServices(subscriptionService: SubscriptionService, monitoredItemService: MonitoredItemService): void {
        this.subscriptionService = subscriptionService
        this.monitoredItemService = monitoredItemService
    }

    /**
     * Restarts the publish pipeline if there are entries and it is not already running.
     * Call this after `updateServices()` to resume notifications on a re-established channel
     * where the server-side subscriptions are still alive (session reactivation path).
     */
    restartPublishLoop(): void {
        if (this.isRunning || this.entries.length === 0) return
        this.isRunning = true
        this.startPublishPipeline()
    }

    /**
     * Creates a Subscription and MonitoredItems for `ids` (OPC UA Part 4, §5.13.2 / §5.14).
     *
     * Can be called more than once: each call creates an independent Subscription (its
     * own server-assigned `subscriptionId`, `publishingInterval`, and `priority`) rather
     * than throwing (Subscription Client Multiple conformance unit). All Subscriptions
     * created on this handler share the single Publish pipeline started on the first call.
     *
     * @returns The server-assigned `subscriptionId` for the new Subscription.
     */
    async subscribe(
        ids: NodeId[],
        callback: (data: { id: NodeId; value: unknown }[]) => void,
        options?: SubscriptionOptions
    ): Promise<number> {
        const subscriptionId = await this.subscriptionService.createSubscription(options)
        const items = []
        for (const id of ids) {
            const entry = new SubscriptionHandlerEntry(subscriptionId, this.nextHandle++, id, callback)
            this.entries.push(entry)
            items.push({ id, handle: entry.handle })
        }
        await this.monitoredItemService.createMonitoredItems(subscriptionId, items, options)

        // Start the shared publish pipeline on the first subscription; later calls reuse it
        // since Publish is a per-Session service, not per-Subscription.
        if (!this.isRunning) {
            this.isRunning = true
            this.startPublishPipeline()
        }

        return subscriptionId
    }

    /**
     * Launches `publishPipelineDepth` concurrent long-poll workers so the server always
     * has multiple outstanding `Publish` requests to answer (Subscription Client Publish
     * Multiple conformance unit — OPC UA Part 4, §5.13.5).
     */
    private startPublishPipeline(): void {
        const myGeneration = ++this.generation
        for (let i = 0; i < this.publishPipelineDepth; i++) {
            void this.runPublishWorker(myGeneration)
        }
    }

    /**
     * One pipeline slot: repeatedly issues a `Publish` request and, as soon as the
     * response arrives, immediately issues the next one — without waiting on the other
     * concurrently-running workers — until the handler is stopped or superseded by a
     * newer generation (see `startPublishPipeline`).
     */
    private async runPublishWorker(myGeneration: number): Promise<void> {
        while (this.isRunning && this.generation === myGeneration) {
            // Drain any acknowledgements accumulated by this or other workers so they are
            // sent exactly once, on whichever Publish request goes out next.
            const acknowledgements = this.acknowledgementQueue.splice(0, this.acknowledgementQueue.length)

            let response: PublishResponse
            try {
                response = await this.subscriptionService.publish(acknowledgements)
            } catch (err) {
                // Only the first worker to observe the failure reports it; guard against
                // duplicate onPublishError calls when multiple pipeline slots fail together.
                if (!this.isRunning || this.generation !== myGeneration) return
                // A closed channel isn't a real failure — it's expected on disconnect or
                // reconnect, so it doesn't warrant an error-level log.
                if (err instanceof ChannelClosedError) {
                    this.logger.debug(`Publish loop stopped: ${err.message}`)
                } else {
                    this.logger.error(`Publish failed, stopping publish loop: ${err}`)
                }
                this.isRunning = false
                this.onPublishError?.()
                return
            }

            if (!this.isRunning || this.generation !== myGeneration) return
            this.handlePublishResponse(response)
        }
    }

    // https://reference.opcfoundation.org/Core/Part4/v105/docs/5.14.5
    private handlePublishResponse(response: PublishResponse): void {
        const { subscriptionId, availableSequenceNumbers, notificationMessage } = response
        const notificationDatas = notificationMessage?.notificationData ?? []
        const seqNumber = notificationMessage?.sequenceNumber

        // Per spec: only acknowledge sequence numbers that are in availableSequenceNumbers
        // and only for real notification messages (not keep-alive, which have empty notificationData).
        const isKeepAlive = notificationDatas.length === 0

        if (!isKeepAlive && seqNumber !== undefined) {
            // Acknowledge only if the server still lists this sequence number as available.
            const isAvailable = !availableSequenceNumbers || availableSequenceNumbers.includes(seqNumber)
            if (isAvailable) {
                const ack = new SubscriptionAcknowledgement()
                ack.subscriptionId = subscriptionId
                ack.sequenceNumber = seqNumber
                this.acknowledgementQueue.push(ack)
            }
        }

        // Dispatch notifications to registered callbacks, routed to the entries of the
        // Subscription this PublishResponse belongs to (Subscription Client Multiple).
        for (const notificationData of notificationDatas) {
            const decodedData = notificationData.data
            const rawTypeId = notificationData.typeId
            const typeNodeId = rawTypeId instanceof ExpandedNodeId ? rawTypeId.nodeId : rawTypeId

            if (typeNodeId.namespace === 0 && typeNodeId.identifier === NODE_ID_DATA_CHANGE_NOTIFICATION) {
                const dataChangeNotification = decodedData as DataChangeNotification
                for (const item of dataChangeNotification.monitoredItems) {
                    const entry = this.entries.find(
                        e => e.subscriptionId === subscriptionId && e.handle === item.clientHandle,
                    )
                    entry?.callback([{ id: entry.id, value: item.value.value?.value }])
                }
            } else if (typeNodeId.namespace === 0 && typeNodeId.identifier === NODE_ID_STATUS_CHANGE_NOTIFICATION) {
                // The server notifies us the subscription state has changed (e.g. expired, closed, shutdown).
                const statusChange = decodedData as StatusChangeNotification
                this.logger.warn(
                    `Subscription ${subscriptionId} status changed: 0x${statusChange.status?.toString(16).toUpperCase()}`,
                )
                this.isRunning = false
                // OPC UA Part 4, §5.13.6.2: BadShutdown / BadServerHalted indicates the server is
                // shutting down.  Notify the client so it can schedule a reconnect.
                const status = statusChange.status
                if (
                    status === StatusCode.BadShutdown ||
                    status === StatusCode.BadServerHalted
                ) {
                    this.logger.warn('Server shutdown announced via StatusChangeNotification — triggering reconnect.')
                    this.onShutdown?.()
                }
                return
            } else {
                this.logger.warn(
                    `Notification data type ${typeNodeId.namespace}:${typeNodeId.identifier} is not supported.`,
                )
            }
        }
    }

    constructor(
        private subscriptionService: SubscriptionService,
        private monitoredItemService: MonitoredItemService,
        private readonly publishPipelineDepth: number = DEFAULT_PUBLISH_PIPELINE_DEPTH,
    ) {}
}