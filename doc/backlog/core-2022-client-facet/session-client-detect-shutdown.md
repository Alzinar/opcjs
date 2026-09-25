# Session Client Detect Shutdown

**Facet**: Core 2022 Client Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

A server that is about to shut down announces this through the `ServerStatus/State` variable before closing connections. This conformance unit requires the client to monitor `ServerStatus/State` and respond appropriately when a shutdown is announced.

### Server shutdown sequence

1. Server sets `ServerStatus/State` to `Shutdown` (value = 4).
2. Server may set `ServerStatus/EstimatedReturnTime` to indicate when it expects to be back.
3. Server sends a `StatusChangeNotification` with `Bad_ServerHalted` to all active subscriptions.
4. Server begins closing sessions and SecureChannels.

### Client behaviour

When `ServerStatus/State = Shutdown` is detected (via subscription notification or keep-alive read), the client should:
1. Stop sending new service requests.
2. Read `EstimatedReturnTime` (see [Base Info Client Estimated Return Time](./base-info-client-estimated-return-time.md)).
3. Notify the application that the server is shutting down.
4. Schedule a reconnect attempt at the appropriate time.

### Detection mechanism options

| Method | Description |
|--------|-------------|
| Subscription to `ServerStatus/State` | `CreateMonitoredItem` on NodeId `ns=0; i=2259`. Most efficient; server pushes changes. |
| Periodic `Read` in keep-alive loop | Read `ServerStatus/State` every keep-alive tick. Less efficient but works without subscriptions. |
| `StatusChangeNotification` | Subscription `PublishResponse` may contain a `StatusChangeNotification` with `Bad_ServerHalted`. |

NodeId for `Server/ServerStatus/State`: `ns=0; i=2259`

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 §12.6 | ServerStatus | Variable containing `State`, `CurrentTime`, `EstimatedReturnTime` etc. |
| OPC 10000-5 §12.6.3 | ServerState | Enumeration: `Running=0`, `Failed=1`, `Shutdown=4`, etc. |
| OPC 10000-4 §5.13.5 | Publish / StatusChangeNotification | How `Bad_ServerHalted` is delivered via subscriptions |

Online: https://reference.opcfoundation.org/Core/Part5/v105/docs/12.6  
Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/5.13.5

## Implementation Gap

The keep-alive loop in `src/client.ts` reads `Server_ServerStatus` (ns=0, i=2256) but does not inspect the `State` field within the result.  
No `StatusChangeNotification` handler checks for `Bad_ServerHalted`.

## Work Required

1. In the keep-alive read callback, decode `ServerStatus.State` and emit a `serverShutdown` event if `State = Shutdown`.
2. In `subscriptionService.ts`, handle `StatusChangeNotification` with `Bad_ServerHalted` status code.
3. Wire both paths into the reconnect / backoff logic and the `EstimatedReturnTime` reader.
4. Expose an `onServerShutdown` callback / event on the `Client` API.

## Implementation

✅ Implemented in `src/client.ts` and `src/subscription/subscriptionHandler.ts`.

### Detection paths

| Path | Where |
|------|-------|
| Keep-alive read | `Client.startKeepAlive()` reads `Server_ServerStatus` (ns=0, i=2256) and inspects the decoded `ServerStatusDataType.state` field for `ServerStateEnum.Shutdown`. |
| `StatusChangeNotification` | `SubscriptionHandler.handlePublishResponse()` inspects the notification's `status` for `StatusCode.BadShutdown` / `StatusCode.BadServerHalted` and invokes its `onShutdown` callback. |

Both paths converge on `Client.handleServerShutdownDetected()` (private), which:

1. Debounces duplicate detections via `shutdownReconnectPending`.
2. Stops the keep-alive timer (no new keep-alive requests while shutting down).
3. Fires the public `Client.onServerShutdown` callback immediately.
4. Reads `EstimatedReturnTime` via `computeReconnectDelayMs()` (Base Info Client Estimated Return Time conformance unit) and schedules a reconnect at the appropriate delay, or fires `onPermanentShutdown` when the server sends `MinDateTime`.

### `Client.onServerShutdown?: () => void` (public)

Fires once per shutdown announcement — via either detection path — before `EstimatedReturnTime` is read and a reconnect is scheduled. This satisfies "notify the application that the server is shutting down" (client behaviour step 3).

### `Client.onPermanentShutdown?: () => void` (public)

Fires instead of scheduling a reconnect when `EstimatedReturnTime` is `MinDateTime` (see [Base Info Client Estimated Return Time](./base-info-client-estimated-return-time.md)).

### Tests

`tests/unit/detectShutdown.test.ts` — covers both detection paths, deduplication, `onServerShutdown` firing, and reconnect scheduling/service reinitialisation.

`ref/opcjs/RefClient/tests/{opcjs,uaNet,open62541}.test.ts` (`describe('detect shutdown', ...)`) — end-to-end ref tests against all three RefServers: each exposes its own test-only, non-OPC-UA control channel that flips `Server/ServerStatus/State` to `Shutdown` with an estimated return time, and the test asserts the real client, over the wire, fires `onServerShutdown` and successfully reconnects and reads again afterwards.

- **opcjs** (`ref/opcjs/RefServer/index.ts`): a localhost-only HTTP control endpoint (`startControlServer`).
- **uaNet** (`ref/uaNet/RefServer/ControlServer.cs`): a raw-TCP control listener calling the real SDK's `StandardServer.SetServerState()` — this genuinely rejects in-flight requests with `Bad_ServerHalted` (spec-conformant), so the control listener also auto-reverts back to `Running` once the given return time elapses, so the client's reconnect lands on a server that has actually come back.
- **open62541** (`ref/open62541/RefServer/src/main.c`): a raw-TCP control listener that installs a custom `UA_CallbackValueSource` override for `Server_ServerStatus` (purely cosmetic — decoupled from open62541's own real shutdown machinery, so the server keeps serving requests throughout).

Writing these tests uncovered and fixed three pre-existing bugs:

1. `opcjs-server`: `ServerStatus`'s `ExtensionObject.typeId` was set to the `ServerStatusDataType` *DataType* ID (862) instead of its *binary encoding* ID (864), which the decoder's `encodingIdMap` requires — any real read of `Server_ServerStatus` failed to decode. Fixed in `packages/server/src/addressSpace/addressSpace.ts`.
2. `opcjs-client`: the keep-alive read callback in `Client.startKeepAlive()` read `results[0].value` directly as `ServerStatusDataType`, without unwrapping the `Variant`/`ExtensionObject` layers `AttributeService.ReadValue` actually returns (`DataValue.value` → `Variant` → `.value` is the `ExtensionObject` → `.data` is the `ServerStatusDataType`). Fixed alongside the mock shape in `tests/unit/detectShutdown.test.ts`.
3. `opcjs-client`: the keep-alive read callback only inspected *successful* reads for `state = Shutdown`; a spec-conformant server that starts actively rejecting requests once shutting down (OPC UA Part 4, §5.13.5) surfaces that as a `Bad_ServerHalted`/`Bad_Shutdown` ServiceFault on the read itself (confirmed against the real uaNet SDK), which the keep-alive handler previously just logged and ignored. `Client.startKeepAlive()` now also treats a `ServiceFault` carrying either status code as a shutdown detection (see `isServerHaltedError()`).

### ⚠️ Known spec-compliance gap: `EstimatedReturnTime`

While adding the uaNet/open62541 ref tests, reflecting over the OPC Foundation .NET SDK's generated `ServerStatusDataType` and cross-checking OPC UA Part 5 §12.10 confirmed that **`ServerStatusDataType` has no `EstimatedReturnTime` field** — the real spec field at that position is `secondsTillShutdown` (`UInt32`, a *relative* seconds-until-shutdown count), not an absolute `DateTime`. `packages/base`'s hand-written `ServerStatusDataType` type added a nonstandard `estimatedReturnTime` field, and both `packages/server`'s `wellKnownIds.ts` (`Server_ServerStatus_EstimatedReturnTime: 2992`) and `packages/client`'s `computeReconnectDelayMs()` (which reads NodeId `ns=0;i=2992` expecting a `Date`) reflect this same non-standard field — self-consistently between opcjs-client and opcjs-server, which is why this went undetected by earlier tests (all in-process/opcjs-to-opcjs). Against a real spec-compliant server, node 2992 holds `SecondsTillShutdown` (a plain number, not a `Date`), so `computeReconnectDelayMs()` harmlessly falls back to `configuration.shutdownReconnectDelayMs` (verified: reads succeed, `instanceof Date` is `false`, no crash) — this conformance unit's detection/reconnect behaviour is unaffected, but the separate [Base Info Client Estimated Return Time](./base-info-client-estimated-return-time.md) conformance unit is built on a misunderstanding of the spec and needs a follow-up fix (rename/repurpose to the real `SecondsTillShutdown` field, at minimum).

## Related Conformance Units

- [Session Client KeepAlive](./session-client-keepalive.md)
- [Session Client Auto Reconnect](./session-client-auto-reconnect.md)
- [Base Info Client Estimated Return Time](./base-info-client-estimated-return-time.md)

