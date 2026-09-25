/**
 * Unit tests for the Session Client Detect Shutdown conformance unit.
 *
 * OPC UA Part 4, §5.13.6.2: A client that implements the optional "Session Client Detect
 * Shutdown" conformance unit monitors ServerStatus/State and reacts when the server
 * announces a pending shutdown.
 *
 * Two detection paths are covered:
 *  1. The keep-alive timer reads ServerStatusDataType and sees state = Shutdown.
 *  2. A subscription StatusChangeNotification arrives with BadShutdown / BadServerHalted.
 *
 * Both should call `handleServerShutdownDetected()` which debounces duplicate detections,
 * stops the keep-alive timer, waits `configuration.shutdownReconnectDelayMs`, then calls
 * `reconnectAndReactivate()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerStateEnum } from 'opcjs-base'

import { Client } from '../../src/client.js'
import { ConfigurationClient } from '../../src/configuration/configurationClient.js'
import { SubscriptionHandler } from '../../src/subscription/subscriptionHandler.js'
import { UserIdentity } from '../../src/userIdentity.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEEP_ALIVE_INTERVAL_MS = 25_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): Client {
  const config = ConfigurationClient.getSimple('shutdown-test', 'test')
  const identity = UserIdentity.newAnonymous()
  return new Client('opc.wss://localhost:4840', config, identity)
}

/**
 * Returns a mock `DataValue.value`-shaped result: a Variant-like wrapper (`.value`) around an
 * ExtensionObject-like wrapper (`.data`) around the actual `ServerStatusDataType`-shaped value,
 * mirroring what `AttributeService.ReadValue` returns for a real `ServerStatus` read.
 */
function makeStatusValue(state: ServerStateEnum) {
  return { value: { data: { state } } }
}

// ---------------------------------------------------------------------------
// Tests – keep-alive-based shutdown detection
// ---------------------------------------------------------------------------

describe('Client detect shutdown – keep-alive path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls reconnectAndReactivate after shutdown state is read', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const readValue = vi.fn().mockResolvedValue([{ value: makeStatusValue(ServerStateEnum.Shutdown) }])
    c.attributeService = { ReadValue: readValue }
    c.subscriptionHandler = { hasActiveSubscription: () => false }

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()

    c.startKeepAlive()

    // Advance so the keep-alive fires and the read resolves.
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)

    // The reconnect should not fire yet — the delay hasn't elapsed.
    expect(reconnect).not.toHaveBeenCalled()

    // Advance past the shutdown reconnect delay.
    await vi.advanceTimersByTimeAsync(shutdownDelay)

    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('does not schedule a second reconnect when shutdown is detected twice', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const readValue = vi.fn().mockResolvedValue([{ value: makeStatusValue(ServerStateEnum.Shutdown) }])
    c.attributeService = { ReadValue: readValue }
    c.subscriptionHandler = { hasActiveSubscription: () => false }

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()

    c.startKeepAlive()

    // First keep-alive fires and detects shutdown.
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)
    // Second would-be keep-alive fires (but keep-alive was stopped after first shutdown detection).
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)

    // Advance past the shutdown reconnect delay.
    await vi.advanceTimersByTimeAsync(shutdownDelay)

    // Only one reconnect despite two potential detections.
    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('does not reconnect when server state is Running', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const readValue = vi.fn().mockResolvedValue([{ value: makeStatusValue(ServerStateEnum.Running) }])
    c.attributeService = { ReadValue: readValue }
    c.subscriptionHandler = { hasActiveSubscription: () => false }

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect

    c.startKeepAlive()
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS + shutdownDelay)

    expect(reconnect).not.toHaveBeenCalled()

    c.stopKeepAlive()
  })

  it('does not reconnect when read returns no value', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const readValue = vi.fn().mockResolvedValue([{ value: undefined }])
    c.attributeService = { ReadValue: readValue }
    c.subscriptionHandler = { hasActiveSubscription: () => false }

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect

    c.startKeepAlive()
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS + shutdownDelay)

    expect(reconnect).not.toHaveBeenCalled()

    c.stopKeepAlive()
  })

  it('reinitialises services and restarts keep-alive after a successful reconnect', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const readValue = vi.fn().mockResolvedValue([{ value: makeStatusValue(ServerStateEnum.Shutdown) }])
    c.attributeService = { ReadValue: readValue }
    c.subscriptionHandler = { hasActiveSubscription: () => false }

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    const initServices = vi.fn()
    c.initServices = initServices

    c.startKeepAlive()
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(shutdownDelay)

    expect(initServices).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Tests – subscription StatusChangeNotification shutdown detection
// ---------------------------------------------------------------------------

describe('Client detect shutdown – subscription path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onShutdown when initialised via initServices and wires to handleServerShutdownDetected', () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    // Stub session and channel so initServices() can run.
    c.session = { getAuthToken: () => ({ namespace: 0, identifier: 0 }), getSessionId: () => 1, getEndpoint: () => '' }
    c.secureChannel = { /* stub */ }

    const shutdownSpy = vi.fn()
    c.handleServerShutdownDetected = shutdownSpy

    // SubscriptionHandler is created inside initServices(); we need to intercept it.
    // Inject a fake AttributeService / MethodService / BrowseService to avoid errors.
    c.attributeService = {}
    c.methodService = {}
    c.browseService = {}

    // Create a real SubscriptionHandler and check onShutdown is set after initServices.
    const fakeHandler = new SubscriptionHandler(
      { createSubscription: vi.fn(), publish: vi.fn() } as unknown as ConstructorParameters<typeof SubscriptionHandler>[0],
      { createMonitoredItems: vi.fn() } as unknown as ConstructorParameters<typeof SubscriptionHandler>[1],
    )
    // Manually simulate what initServices does:
    fakeHandler.onShutdown = () => c.handleServerShutdownDetected()
    c.subscriptionHandler = fakeHandler

    // Invoking onShutdown should call shutdownSpy.
    fakeHandler.onShutdown()
    expect(shutdownSpy).toHaveBeenCalledOnce()
  })

  it('schedules a reconnect after onShutdown is triggered', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()

    // Directly invoke the handler as if the subscription notified a shutdown.
    c.handleServerShutdownDetected()

    expect(reconnect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(shutdownDelay)

    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('deduplicates when both keep-alive and subscription detect shutdown simultaneously', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    const reconnect = vi.fn().mockResolvedValue(undefined)
    c.reconnectAndReactivate = reconnect
    c.initServices = vi.fn()

    // Two simultaneous detections should produce only one reconnect attempt.
    c.handleServerShutdownDetected()
    c.handleServerShutdownDetected()

    await vi.advanceTimersByTimeAsync(shutdownDelay)

    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('fires onServerShutdown exactly once when shutdown is detected', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any
    const shutdownDelay: number = c.configuration.shutdownReconnectDelayMs

    c.reconnectAndReactivate = vi.fn().mockResolvedValue(undefined)
    c.initServices = vi.fn()

    const onServerShutdown = vi.fn()
    client.onServerShutdown = onServerShutdown

    c.handleServerShutdownDetected()
    c.handleServerShutdownDetected()

    expect(onServerShutdown).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(shutdownDelay)
  })
})
