/**
 * Unit tests for the publish-loop error recovery behaviour.
 *
 * OPC UA Part 4, §5.14.5: The Publish service is a long-poll request.  When the
 * underlying channel drops (e.g. Bad_NoCommunication) the publish loop terminates.
 * The client MUST reconnect and restart the loop so notifications resume without
 * requiring the application to re-subscribe.
 *
 * All tests run fully in-process using mock objects – no network connection required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelClosedError, NodeId } from 'opcjs-base'

import { Client } from '../../src/client.js'
import { ConfigurationClient } from '../../src/configuration/configurationClient.js'
import { SubscriptionHandler } from '../../src/subscription/subscriptionHandler.js'
import { UserIdentity } from '../../src/userIdentity.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): Client {
  const config = ConfigurationClient.getSimple('publish-loop-test', 'test')
  return new Client('opc.wss://localhost:4840', config, UserIdentity.newAnonymous())
}

function makeSubHandler() {
  return new SubscriptionHandler(
    { createSubscription: vi.fn(), publish: vi.fn() } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
    { createMonitoredItems: vi.fn() } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
  )
}

// ---------------------------------------------------------------------------
// SubscriptionHandler unit tests
// ---------------------------------------------------------------------------

describe('SubscriptionHandler – publish error callback', () => {
  it('fires onPublishError when publish rejects', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('Bad_NoCommunication'))
    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
    )

    const onPublishError = vi.fn()
    handler.onPublishError = onPublishError

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())

    // Let the event loop flush the rejected publish promise.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(onPublishError).toHaveBeenCalledOnce()
  })

  it('still fires onPublishError when publish rejects with a ChannelClosedError', async () => {
    // A closed channel isn't logged as a failure, but it must still trigger the
    // reconnect path — the connection is just as unusable either way.
    const publish = vi.fn().mockRejectedValue(new ChannelClosedError('SecureChannel connection closed'))
    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
    )

    const onPublishError = vi.fn()
    handler.onPublishError = onPublishError

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(onPublishError).toHaveBeenCalledOnce()
  })

  it('does not fire onPublishError when publish succeeds', async () => {
    const keepAlive = {
      subscriptionId: 1,
      availableSequenceNumbers: [],
      moreNotifications: false,
      notificationMessage: { sequenceNumber: 1, publishTime: new Date(), notificationData: [] },
    }
    let callCount = 0
    const publish = vi.fn().mockImplementation(() => {
      // Resolve once then hang indefinitely to stop the loop cleanly.
      if (callCount++ === 0) return Promise.resolve(keepAlive)
      return new Promise(() => { /* never resolves */ })
    })
    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    const onPublishError = vi.fn()
    handler.onPublishError = onPublishError

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(onPublishError).not.toHaveBeenCalled()
  })

  it('hasEntries returns true after subscribe', async () => {
    const publish = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }))
    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    expect(handler.hasEntries()).toBe(false)
    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    expect(handler.hasEntries()).toBe(true)
  })

  it('stop() prevents a late Publish rejection from triggering onPublishError', async () => {
    let rejectPublish: (err: Error) => void
    const publish = vi.fn()
      .mockResolvedValueOnce({
        subscriptionId: 1,
        availableSequenceNumbers: [],
        moreNotifications: false,
        notificationMessage: { sequenceNumber: 1, publishTime: new Date(), notificationData: [] },
      })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPublish = reject }))

    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    const onPublishError = vi.fn()
    handler.onPublishError = onPublishError

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())
    // Let the first (successful) publish complete and the loop issue the second one.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // Simulate an explicit disconnect: the handler is stopped and detached
    // before the channel teardown rejects the in-flight Publish.
    handler.stop()
    rejectPublish!(new Error('SecureChannel closed'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(onPublishError).not.toHaveBeenCalled()
    expect(handler.hasActiveSubscription()).toBe(false)
  })

  it('restartPublishLoop starts the loop again after a publish error', async () => {
    let resolveSecond: (v: unknown) => void
    const secondPublish = new Promise((resolve) => { resolveSecond = resolve })

    let callCount = 0
    const publish = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error('Bad_NoCommunication'))
      if (callCount === 2) return secondPublish
      return new Promise(() => { /* never resolves */ })
    })

    const handler = new SubscriptionHandler(
      { createSubscription: vi.fn().mockResolvedValue(1), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
      1,
    )

    await handler.subscribe([NodeId.newNumeric(0, 1)], vi.fn())

    // Let the first (failing) publish run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(handler.hasActiveSubscription()).toBe(false)

    // Simulate service update after reconnect.
    handler.updateServices(
      { createSubscription: vi.fn(), publish } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn() } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
    )
    handler.restartPublishLoop()

    expect(handler.hasActiveSubscription()).toBe(true)

    // Let the second publish call run.
    resolveSecond!({
      subscriptionId: 1,
      availableSequenceNumbers: [],
      moreNotifications: false,
      notificationMessage: { sequenceNumber: 2, publishTime: new Date(), notificationData: [] },
    })
    // Two tick rounds: one for the resolved promise, one for the scheduled setTimeout continuation.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // publish was called at least twice: once (failing) before restart and at least once after.
    expect(publish).toHaveBeenCalledTimes(3) // 1st (fail) + 2nd (restart) + 3rd (loop continues)
  })
})

// ---------------------------------------------------------------------------
// Client unit tests – handlePublishLoopError
// ---------------------------------------------------------------------------

describe('Client – publish loop error recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls reconnectAndReactivate immediately when onPublishError fires', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()
    c.startKeepAlive = vi.fn()

    c.handlePublishLoopError()

    // reconnect is called directly (no delay unlike the shutdown path).
    await vi.runAllTimersAsync()

    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('calls initServices and restartPublishLoop after a successful reconnect', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect

    const restartPublishLoop = vi.fn()
    c.subscriptionHandler = { restartPublishLoop, hasEntries: () => true }

    const initServices = vi.fn()
    c.initServices = initServices
    c.startKeepAlive = vi.fn()

    c.handlePublishLoopError()
    await vi.runAllTimersAsync()

    expect(initServices).toHaveBeenCalledOnce()
    expect(restartPublishLoop).toHaveBeenCalledOnce()
  })

  it('does not schedule a second reconnect when error fires twice', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()
    c.subscriptionHandler = { restartPublishLoop: vi.fn(), hasEntries: () => true }
    c.startKeepAlive = vi.fn()

    c.handlePublishLoopError()
    c.handlePublishLoopError() // duplicate

    await vi.runAllTimersAsync()

    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('resets the pending flag so a future error can trigger reconnect again', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()
    c.subscriptionHandler = { restartPublishLoop: vi.fn(), hasEntries: () => true }
    c.startKeepAlive = vi.fn()

    c.handlePublishLoopError()
    await vi.runAllTimersAsync()

    // First reconnect finished; a subsequent publish error should trigger another reconnect.
    c.handlePublishLoopError()
    await vi.runAllTimersAsync()

    expect(reconnect).toHaveBeenCalledTimes(2)
  })

  it('logs a warning and does not throw when reconnect fails', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const reconnect = vi.fn().mockRejectedValue(new Error('network unreachable'))
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()
    c.startKeepAlive = vi.fn()

    // Should not throw.
    c.handlePublishLoopError()
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow()

    expect(reconnect).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Client – initServices preserves handler entries on reconnect
// ---------------------------------------------------------------------------

describe('Client – initServices preserves subscription handler entries', () => {
  it('reuses existing handler when it has entries', () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const updateServices = vi.fn()
    const existingHandler = makeSubHandler()
    // Simulate a handler that already has subscriptions.
    vi.spyOn(existingHandler, 'hasEntries').mockReturnValue(true)
    vi.spyOn(existingHandler, 'updateServices').mockImplementation(updateServices)

    c.subscriptionHandler = existingHandler
    c.session = { getAuthToken: () => NodeId.newTwoByte(0) }
    c.secureChannel = {}

    // Spy out refreshNamespaceTable to avoid side effects.
    c.refreshNamespaceTable = vi.fn().mockResolvedValue(undefined)

    c.initServices()

    // The same handler instance must be kept.
    expect(c.subscriptionHandler).toBe(existingHandler)
    // Its services must have been updated for the new channel.
    expect(updateServices).toHaveBeenCalledOnce()
  })

  it('creates a new handler when existing handler has no entries', () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const existingHandler = makeSubHandler()
    vi.spyOn(existingHandler, 'hasEntries').mockReturnValue(false)

    c.subscriptionHandler = existingHandler
    c.session = { getAuthToken: () => NodeId.newTwoByte(0) }
    c.secureChannel = {}
    c.refreshNamespaceTable = vi.fn().mockResolvedValue(undefined)

    c.initServices()

    expect(c.subscriptionHandler).not.toBe(existingHandler)
  })

  it('wires onPublishError on the new handler in initServices', () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    c.subscriptionHandler = undefined
    c.session = { getAuthToken: () => NodeId.newTwoByte(0) }
    c.secureChannel = {}
    c.refreshNamespaceTable = vi.fn().mockResolvedValue(undefined)

    const publishErrorSpy = vi.fn()
    c.handlePublishLoopError = publishErrorSpy

    c.initServices()

    expect(typeof c.subscriptionHandler.onPublishError).toBe('function')

    // Invoking the wired callback should call handlePublishLoopError.
    c.subscriptionHandler.onPublishError()
    expect(publishErrorSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Client – disconnect() must not trigger a spurious auto-reconnect
// ---------------------------------------------------------------------------

describe('Client – disconnect stops the subscription handler', () => {
  it('calls subscriptionHandler.stop() before tearing down the channel', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const stop = vi.fn()
    c.subscriptionHandler = { stop }
    c.session = undefined
    c.sessionHandler = undefined
    c.secureChannelFacade = { close: vi.fn() }
    c.ws = { close: vi.fn() }

    await client.disconnect()

    expect(stop).toHaveBeenCalledOnce()
  })
})
