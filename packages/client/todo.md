
---

## A. Core 2022 Client Facet — Required Conformance Units

| Done | Conformance Unit | Status | Notes |
|------|-----------------|--------|-------|
| ✅ | Address Space Client NodeId IdTypes | Done | All 4 types (Numeric, String, Guid, Opaque) in `nodeId.ts` |
| ✅ | Documentation – Core Capacities | Done | README – Core Capacities section documents SecureChannels, Sessions, ContinuationPoints, Subscriptions, etc. |
| ✅ | Security Administration | Done | `SecurityConfiguration` type in `securityConfiguration.ts`. Enforced in `client.ts` (`allowSecurityPolicyNone`, `messageSecurityMode`) and `sessionHandler.ts` (`allowedUserTokenTypes`). Certificate trust/validation now handled via `certificateStore` / `validateServerCertificate` (see Security Admin – Certificate Management). |
| ✅ | Session Client Auto Reconnect | Done | `withSessionRefresh()` in `client.ts` catches `SessionInvalidError` AND transport-level errors. On transport error it calls `reconnectAndReactivate()`: reopens the channel, tries `ActivateSession` on the existing session, and only creates a brand-new session if that fails. |
| ✅ | Session Client Base | Done | `CreateSession` ✅, `ActivateSession` ✅, `CloseSession` ✅ — `disconnect()` in `client.ts` calls `sessionHandler.closeSession(true)` then tears down the SecureChannel and WebSocket. |
| ✅ | Session Client General Service Behaviour | Done | Auth token, requestHandle, and serviceResult evaluation all handled in `serviceBase.ts`. |
| ✅ | Session Client KeepAlive | Done | Dedicated `startKeepAlive()` timer in `client.ts` reads `Server_ServerStatus` (ns=0, i=2256) every 25 s. Skipped when a subscription's Publish loop is already active (`subscriptionHandler.hasActiveSubscription()`). Cancelled by `stopKeepAlive()` in `disconnect()`. |

## A. Core 2022 Client Facet — Optional Conformance Units

| Done | Conformance Unit | Status | Notes |
|------|-----------------|--------|-------|
| ❌ | Base Info Client Currency | Not impl | No CurrencyUnit Property handling |
| ✅ | Base Info Client Estimated Return Time | Done | After shutdown detection, `Client.computeReconnectDelayMs()` reads `Server/ServerStatus/EstimatedReturnTime` (ns=0,i=2992). Future date → delay=ERT−now. Past date → reconnect in 1 s. MinDateTime → fires `onPermanentShutdown`, no reconnect. Errors → fall back to `shutdownReconnectDelayMs`. |
| ✅ | Base Info Client Selection List | Done | `Client.getSelectionList(nodeId)` browses `HasProperty` references (`Selections`, `SelectionDescriptions`, `RestrictToList`) and returns a typed `SelectionList` object for application-layer use. |
| ✅ | Base Services Client Diagnostics | Done | `returnDiagnostics` field on `RequestOptions`; callers pass it to `read()`, `callMethod()`, and `browse()`. Diagnostic info is returned in `ReadValueResult.diagnosticInfo` and `CallMethodResult.diagnosticInfo`. |
| ❌ | Security Admin – Certificate Management | Not impl | No cert store / trust list management |
| ❌ | Session Client Cancel | Not impl | CancelRequest type exists in schema but there is no client-level API |
| ✅ | Session Client Detect Shutdown | Done | `startKeepAlive()` checks `ServerStatusDataType.state === ServerStateEnum.Shutdown`; subscription `StatusChangeNotification` with `BadShutdown`/`BadServerHalted` triggers `handleServerShutdownDetected()` which debounces and calls `reconnectAndReactivate()` after a 5 s delay. |
| ✅ | Session Client Impersonate | Done | `impersonate(identity)` on `Client` calls `ActivateSession` with the new token; updates stored identity for reconnect/refresh. `Session.impersonate()` delegates to `activateSession()`. |
| ✅ | Session Client Renew NodeIds | Done | `NamespaceTable` class tracks URI→index mapping. `Client.refreshNamespaceTable()` reads `Server.NamespaceArray` (ns=0,i=2255) after every session establishment and fires `onNamespaceTableChanged(oldTable, newTable)` when it changes. `NamespaceTable.remapNodeId()` recalculates a NodeId’s namespace index. `Client.getNamespaceTable()` exposes the current table. |

---

## B. UA-TCP UA-SC UA-Binary — Required Conformance Units

| Done | Conformance Unit | Status | Notes |
|------|-----------------|--------|-------|
| ✅ | Protocol UA TCP | Done | Hello/Ack in `tcpConnectionHandler.ts` |
| ✅ | UA Binary Encoding | Done | Full codec in `binaryReader.ts` / `binaryWriter.ts` |
| ✅ | UA Secure Conversation | Done | `secureChannelFacade.ts` with chunking and token renewal at 75% of lifetime |

---

## C. SecurityPolicy – None — Required Conformance Units

| Done | Conformance Unit | Status | Notes |
|------|-----------------|--------|-------|
| ✅ | AsymmetricEncryptionAlgorithm_None | Done | No-op in `securityPolicyNone.ts` |
| ✅ | AsymmetricSignatureAlgorithm_None | Done | No-op |
| ✅ | KeyDerivationAlgorithm_None | Done | No-op |
| ✅ | Security None CreateSession ActivateSession | Done | `clientNonce = null`, `clientCertificate = null`; null/empty signatures |
| ✅ | SecurtyPolicy_None_Limits | Done | Signature key length = 0 |
| ✅ | SymmetricEncryptionAlgorithm_None | Done | No-op |
| ✅ | SymmetricSignatureAlgorithm_None | Done | No-op |
| ✅ | Security None CreateSession ActivateSession 1.0 *(optional)* | Done | `CertificateRequiredError` thrown for `BadCertificateInvalid` / `BadSecurityChecksFailed` / `BadNoValidCertificates`; `SessionHandler.createNewSession()` retries with `securityConfiguration.applicationInstanceCertificate` when set |

---

## D. Security Time Synchronization — Required Conformance Units

| Done | Conformance Unit | Notes |
|------|-----------------|-------|
| ❌ | **Time Sync – Support** *(required — must satisfy at least one optional CU below)* | **No time sync mechanism at all.** |
| ❌ | Time Sync – Configure Clock Skew *(optional)* | |
| ❌ | Time Sync – IEEE 1588 PTP *(optional)* | |
| ❌ | Time Sync – IEEE 802.1AS *(optional)* | |
| ❌ | Time Sync – NTP *(optional)* | |
| ✅ | Time Sync – OS based support *(optional)* | Documented in README – Time Synchronisation section; satisfies the required "Time Sync – Support" CU. |
| ❌ | Time Sync – UA based support *(optional)* | |

---

## E. User Token – Anonymous Client — Required Conformance Units

| Done | Conformance Unit | Status | Notes |
|------|-----------------|--------|-------|
| ✅ | Security User Anonymous Client | Done | `UserIdentity.newAnonymous()` in `userIdentity.ts` |

---

## F. Base Client Behaviour Facet — Required Conformance Units

| Done | Conformance Unit | Status | Notes |
|------|-----------------|--------|-------|
| ✅ | Discovery Client Configure Endpoint | Done | `Client.getEndpoints()` queries `GetEndpoints` via the new `DiscoveryService`; `Client.connect(endpoint?)` accepts a pre-selected `EndpointDescription` to bypass it. |
| ✅ | Security Administration | Done | See Core 2022 Client Facet — same implementation. |
| ✅ | Security Certificate Administration | Done | `securityConfiguration.applicationInstanceCertificate` is now sent proactively as `clientCertificate` on every `CreateSession`; new `privateKey` field stores the matching key. |
| ✅ | Base Info Client Remote Nodes | Done | `isRemoteNode()` / `RemoteNodeError` / `resolveLocalNodeId()` in `remoteNode.ts`; `BrowseNodeResult.isRemote()`; recursive `browse()` skips remote nodes instead of mis-resolving them. |
| ✅ | Session Client Auto Reconnect | Done | See Core 2022 Client Facet — same implementation. |
| ✅ | Subscription Client Multiple | Done | `SubscriptionHandler.subscribe()` creates independent Subscriptions instead of throwing on a second call; notifications routed by `subscriptionId`. |
| ✅ | Subscription Client Publish Multiple | Done | `SubscriptionHandler` runs a concurrent Publish pipeline (default depth 2) instead of a single in-flight request. |

---

## Prioritised Backlog

### P0 — Blocking required conformance units (must be implemented)

- [x] **CloseSession** — implement `CloseSessionRequest` in `sessionService.ts` and wire into `client.disconnect()`.
- [x] **Session KeepAlive without subscriptions** — add a dedicated keep-alive timer that reads `Server_ServerStatus` (or a similar cheap node) at regular intervals when no subscription is active.
- [x] **Auto Reconnect – ActivateSession on existing session** — when the SecureChannel drops but the session timeout has not expired, attempt `ActivateSession` on a new channel before creating a brand-new session.
- [x] **Documentation – Core Capacities** — add a section to the README stating the supported number of SecureChannels, Sessions, ContinuationPoints, etc.
- [x] **Time Sync – OS based support (claim)** — document that the client relies on the OS system clock (NTP / systemd-timesyncd) so the "Time Sync – Support" required CU is satisfied.

### P1 — Required conformance units (substantial gaps)

- [x] **Security Administration** — introduce a `SecurityConfiguration` type to configure: user-token policies, enable/disable SecurityPolicy None, MessageSecurityMode selection, trusted CAs, and unknown-certificate policy.

### P2 — Optional conformance units (nice to have)

- [x] **Service diagnostics** — expose `returnDiagnostics` in the request options so callers can request diagnostic info.
- [x] **Session Cancel** — expose `CancelRequest` as a client API.
- [x] **Detect Server Shutdown** — monitor `ServerStatus/State` and trigger a reconnect when a server shutdown is announced.
- [x] **Session Impersonate** — add an explicit `impersonate(identity)` method that calls `ActivateSession` with a different identity token.
- [x] **Renew NodeIds** — track the NamespaceTable after session establishment and detect/recalculate NodeId Namespace Indices when it changes.
- [x] **EstimatedReturnTime** — read `Server/ServerStatus/EstimatedReturnTime` during reconnect logic to schedule the next retry intelligently.
- [ ] **CurrencyUnit Property** — handle `CurrencyUnitType` on DataVariables that represent currency values.
- [x] **SelectionListType** — recognise and expose `SelectionListType` variables to the application layer.
- [x] **Security None with cert fallback** — if the server rejects CreateSession without a certificate, retry with an ApplicationInstanceCertificate.