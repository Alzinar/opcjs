import {
    ChannelClosedError,
    DataChangeNotification,
    ExpandedNodeId,
    getLogger,
    NodeId,
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

export class SubscriptionHandler {
    private logger = getLogger('SubscriptionHandler')
    private entries = new Array<SubscriptionHandlerEntry>()
    private nextHandle = 0
    private isRunning = false
    /** Guards against multiple concurrent publish loops. */
    private publishInFlight = false

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
     * Stops the publish loop and detaches the reconnect callbacks.
     *
     * Call this during an explicit `Client.disconnect()`, before tearing down the
     * channel: closing the channel now rejects any in-flight Publish request, and
     * without this the resulting `onPublishError` would trigger an unwanted
     * auto-reconnect right after the application asked to disconnect.
     */
    stop(): void {
        this.isRunning = false
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
     * Restarts the publish loop if there are entries and the loop is not already running.
     * Call this after `updateServices()` to resume notifications on a re-established channel
     * where the server-side subscriptions are still alive (session reactivation path).
     */
    restartPublishLoop(): void {
        if (this.isRunning || this.entries.length === 0) return
        this.isRunning = true
        void this.publishLoop([])
    }

    async subscribe(
        ids: NodeId[], 
        callback: (data: { id: NodeId; value: unknown }[]) => void, 
        options?: SubscriptionOptions
    ) {
        if (this.entries.length > 0) {
            throw new Error('Subscribing more than once is not implemented')
        }

        const subscriptionId = await this.subscriptionService.createSubscription(options)
        const items = []
        for (const id of ids) {
            const entry = new SubscriptionHandlerEntry(subscriptionId, this.nextHandle++, id, callback)
            this.entries.push(entry)
            items.push({ id, handle: entry.handle })
        }
        await this.monitoredItemService.createMonitoredItems(subscriptionId, items, options)

        // Start the publish loop with no pending acknowledgements.
        this.isRunning = true
        void this.publishLoop([])
    }

    // https://reference.opcfoundation.org/Core/Part4/v105/docs/5.14.5
    private async publishLoop(pendingAcknowledgements: SubscriptionAcknowledgement[]): Promise<void> {
        if (!this.isRunning) return

        // Prevent a second publish loop from running concurrently.  This can
        // happen when routeFrames settles two responses back-to-back and each
        // continuation attempts to start a new iteration.
        if (this.publishInFlight) return
        this.publishInFlight = true

        let response
        try {
            response = await this.subscriptionService.publish(pendingAcknowledgements)
        } catch (err) {
            // A closed channel isn't a real failure — it's expected on disconnect or
            // reconnect, so it doesn't warrant an error-level log.
            if (err instanceof ChannelClosedError) {
                this.logger.debug(`Publish loop stopped: ${err.message}`)
            } else {
                this.logger.error(`Publish failed, stopping publish loop: ${err}`)
            }
            this.isRunning = false
            this.publishInFlight = false
            this.onPublishError?.()
            return
        }
        this.publishInFlight = false

        const { subscriptionId, availableSequenceNumbers, moreNotifications, notificationMessage } = response
        const notificationDatas = notificationMessage?.notificationData ?? []
        const seqNumber = notificationMessage?.sequenceNumber

        // Build acknowledgements for the next publish request.
        // Per spec: only acknowledge sequence numbers that are in availableSequenceNumbers
        // and only for real notification messages (not keep-alive, which have empty notificationData).
        const nextAcknowledgements: SubscriptionAcknowledgement[] = []
        const isKeepAlive = notificationDatas.length === 0

        if (!isKeepAlive && seqNumber !== undefined) {
            // Acknowledge only if the server still lists this sequence number as available.
            const isAvailable = !availableSequenceNumbers || availableSequenceNumbers.includes(seqNumber)
            if (isAvailable) {
                const ack = new SubscriptionAcknowledgement()
                ack.subscriptionId = subscriptionId
                ack.sequenceNumber = seqNumber
                nextAcknowledgements.push(ack)
            }
        }

        // Dispatch notifications to registered callbacks.
        for (const notificationData of notificationDatas) {
            const decodedData = notificationData.data
            const rawTypeId = notificationData.typeId
            const typeNodeId = rawTypeId instanceof ExpandedNodeId ? rawTypeId.nodeId : rawTypeId

            if (typeNodeId.namespace === 0 && typeNodeId.identifier === NODE_ID_DATA_CHANGE_NOTIFICATION) {
                const dataChangeNotification = decodedData as DataChangeNotification
                for (const item of dataChangeNotification.monitoredItems) {
                    const entry = this.entries.find(e => e.handle === item.clientHandle)
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

        // Per spec: if moreNotifications is true the server has more queued data — re-publish immediately
        // without delay so the server's queue drains before its lifetime counter expires.
        // Otherwise, schedule the next publish after a short yield to avoid a tight synchronous loop.
        if (moreNotifications) {
            void this.publishLoop(nextAcknowledgements)
        } else {
            setTimeout(() => void this.publishLoop(nextAcknowledgements), 0)
        }
    }

    constructor(
        private subscriptionService: SubscriptionService,
        private monitoredItemService: MonitoredItemService,
    ) {}
}