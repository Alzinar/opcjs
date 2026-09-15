/**
 * Unit tests for:
 *  - Subscription Client Multiple (OPC UA Part 4, §5.13.2 / §5.13.5): the client
 *    can create more than one Subscription on the same session, each with its own
 *    entries, and each `PublishResponse` is routed to the correct Subscription.
 *  - Subscription Client Publish Multiple (OPC UA Part 4, §5.13.5): the client
 *    keeps a pipeline of multiple `Publish` requests outstanding at all times.
 *
 * All tests run fully in-process using mock services – no network connection required.
 */

import { describe, expect, it, vi } from 'vitest'

import { NodeId } from 'opcjs-base'

import { SubscriptionHandler } from '../../src/subscription/subscriptionHandler.js'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function makeNotification(subscriptionId: number, seqNumber: number, clientHandle: number, value: unknown) {
  return {
    subscriptionId,
    availableSequenceNumbers: [seqNumber],
    moreNotifications: false,
    notificationMessage: {
      sequenceNumber: seqNumber,
      publishTime: new Date(),
      notificationData: [
        {
          typeId: NodeId.newNumeric(0, 811), // DataChangeNotification
          data: {
            monitoredItems: [
              { clientHandle, value: { value: { value } } },
            ],
          },
        },
      ],
    },
  }
}

describe('SubscriptionHandler – multiple subscriptions', () => {
  it('creates independent subscriptions instead of throwing on a second subscribe() call', async () => {
    let nextId = 1
    const createSubscription = vi.fn().mockImplementation(async () => nextId++)
    const createMonitoredItems = vi.fn().mockResolvedValue(undefined)
    const publish = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }))

    const handler = new SubscriptionHandler(
      { createSubscription, publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    const id1 = await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn(), { requestedPublishingInterval: 100 })
    const id2 = await handler.subscribe([NodeId.newNumeric(0, 2)], vi.fn(), { requestedPublishingInterval: 5000 })

    expect(id1).toBe(1)
    expect(id2).toBe(2)
    expect(createSubscription).toHaveBeenCalledTimes(2)
    expect(createSubscription).toHaveBeenNthCalledWith(1, { requestedPublishingInterval: 100 })
    expect(createSubscription).toHaveBeenNthCalledWith(2, { requestedPublishingInterval: 5000 })
    expect(handler.hasEntries()).toBe(true)
  })

  it('routes each PublishResponse to the callback of the matching subscriptionId', async () => {
    let nextId = 1
    const createSubscription = vi.fn().mockImplementation(async () => nextId++)
    const createMonitoredItems = vi.fn().mockResolvedValue(undefined)

    const pending: Deferred<unknown>[] = []
    const publish = vi.fn().mockImplementation(() => {
      const d = deferred<unknown>()
      pending.push(d)
      return d.promise
    })

    const handler = new SubscriptionHandler(
      { createSubscription, publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    const callback1 = vi.fn()
    const callback2 = vi.fn()

    await handler.subscribe([NodeId.newNumeric(0, 1)], callback1)
    // First subscribe already issued one Publish request (pipeline depth 1); resolve it with
    // a keep-alive so the worker moves on to the request the second subscription will use.
    pending[0].resolve({ subscriptionId: 1, availableSequenceNumbers: [], moreNotifications: false, notificationMessage: { sequenceNumber: 0, publishTime: new Date(), notificationData: [] } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    await handler.subscribe([NodeId.newNumeric(0, 2)], callback2)

    // Handles are assigned from a shared, ever-increasing counter across subscriptions:
    // subscription 1's single item got handle 0, so subscription 2's gets handle 1.
    pending[pending.length - 1].resolve(makeNotification(2, 1, 1, 'sub2-value'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(callback2).toHaveBeenCalledWith([{ id: expect.any(NodeId), value: 'sub2-value' }])
    expect(callback1).not.toHaveBeenCalled()
  })
})

describe('SubscriptionHandler – concurrent publish pipeline', () => {
  it('keeps the configured number of Publish requests outstanding at once', async () => {
    const publish = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }))
    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      3,
    )

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())

    // All 3 pipeline workers issue their first Publish synchronously (before any response arrives).
    expect(publish).toHaveBeenCalledTimes(3)
  })

  it('immediately issues a new Publish request as soon as one resolves, without waiting for the others', async () => {
    const pending: Deferred<unknown>[] = []
    const publish = vi.fn().mockImplementation(() => {
      const d = deferred<unknown>()
      pending.push(d)
      return d.promise
    })

    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      2,
    )

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    expect(publish).toHaveBeenCalledTimes(2)

    // Resolve only the first of the two outstanding requests with a keep-alive.
    pending[0].resolve({
      subscriptionId: 1,
      availableSequenceNumbers: [],
      moreNotifications: false,
      notificationMessage: { sequenceNumber: 1, publishTime: new Date(), notificationData: [] },
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // A third request was issued immediately; the second (still-pending) request was not waited on.
    expect(publish).toHaveBeenCalledTimes(3)
  })

  it('includes accumulated acknowledgements on the next outgoing Publish request', async () => {
    const pending: Deferred<unknown>[] = []
    const publish = vi.fn().mockImplementation(() => {
      const d = deferred<unknown>()
      pending.push(d)
      return d.promise
    })

    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    expect(publish).toHaveBeenNthCalledWith(1, [])

    pending[0].resolve(makeNotification(1, 42, 0, 'value'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(publish).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ subscriptionId: 1, sequenceNumber: 42 }),
    ])
  })

  it('only reports onPublishError once when multiple pipeline workers fail together', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('Bad_NoCommunication'))
    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      2,
    )

    const onPublishError = vi.fn()
    handler.onPublishError = onPublishError

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(onPublishError).toHaveBeenCalledOnce()
    expect(handler.hasActiveSubscription()).toBe(false)
  })
})
