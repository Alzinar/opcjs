# Ref test suite – TODO

Tests needed to cover every implemented facet (see [`doc/backlog/README.md`](../doc/backlog/README.md)).

Legend: `[x]` covered today, `[ ]` missing.

**Client-facet tests** run in `RefClientNode` + `RefClientWeb` against all three RefServers (uaNet, open62541, opcjs).
**Server-facet tests** run against `opcjs/RefServer` from `RefClientNode`/`RefClientWeb` (opcjs-client) and from `uaNet/RefClient` (3rd-party client).
New shared test bodies go into `ref/opcjs/RefClientNode/tests/shared.ts`; the .NET equivalents into `ref/uaNet/RefClient/`.

## 0. Prerequisites (shared infrastructure)

- [x] Extend the common address space — see [Common address space](README.md#common-address-space); verified on all three servers by the `common address space` tests
  - [x] `Integer` (Int32, auto-incrementing), `Int64Array`
  - [x] One scalar and one array variable per BuiltInType (incl. Variant, DiagnosticInfo, DataValue, ExtensionObject) and a >1-chunk `LargeDoubleArray`
  - [x] Nodes with Numeric / String / Guid / Opaque NodeId identifiers
  - [x] Read-only, write-only, timestamp/status-writable and historizing variables
  - [x] Folder with 150 children (continuation points / `BrowseNext`)
  - [x] Method `Add(Int32, Int32) -> Int32` and asynchronous `Slow(ms)` (for Cancel) — uaNet and open62541 only (`opcjs-server` has no Call service)
  - [x] `Temperature` (`EngineeringUnits`, `EURange`), `Price` (`CurrencyUnit`), `Mode` (`Selections`, `SelectionDescriptions`, `RestrictToList`)
  - [x] Server-facet nodes (OptionSet, ValueAsText, constants, AddIn/interfaces, `Locations`, namespace metadata): already built into `opcjs-server` (ns=1), no ref-server work needed
  - [x] Timer-driven `Triangle` wave (and `Static_Int32` as a never-changing variable)
- [x] Server control channel — see [Control channel](README.md#control-channel): `DropConnections`, `CloseSessions`, `SessionCount`, `AddNamespace <uri>`, `SetMaxSessions <n>`, `SetMaxSessionTimeout <ms>` on all three servers, each smoke-tested (the client always requests a 60 s session timeout, so the server-side maximum is lowered instead; `opcjs` and `uaNet` also have a 1 s minimum)
- [ ] Optional: configurable user tokens (username/password) on uaNet + open62541 for impersonate tests.
- [ ] Optional: opcjs RefServer with TLS (`wss://`) so security policies can be tested beyond None.
- [ ] Update `doc/spec/interop-testing.md` "Tested features" list as items below are completed.

Findings while building the prerequisites (to fix or work around in the tests below):
- `opcjs-client` raises unhandled rejections (`WebSocket is not open`) when its connection is dropped underneath it (e.g. `DropConnections`, or an earlier test's lingering client). `DropConnections` is therefore verified with a bare WebSocket and runs first in each test file. Needed for the Auto Reconnect test.
- `opcjs-server`: `CreateSession` over the session limit used to throw instead of returning a `ServiceFault` with `BadTooManySessions` (client hung); fixed in `ServiceDispatcher` together with a unit test.
- `opcjs-server` has no Call/Cancel service: the `Methods` object, Browse/Call and Cancel tests only run against uaNet and open62541.

## 1. Client facets (opcjs-client vs uaNet / open62541 / opcjs RefServer)

### UA-TCP UA-SC UA-Binary
- [ ] Binary encoding round-trip: read + write every BuiltInType scalar and array (incl. LocalizedText, QualifiedName, ByteString, Guid, DateTime, ExtensionObject, Variant, StatusCode)
- [ ] Large message: read/write array exceeding one chunk (multi-chunk send and receive)
- [ ] SecureChannel renewal: short `requestedLifetime`, keep session busy past the renewal point, reads keep working
- [ ] `HEL`/`ACK` limits negotiated against each server (buffer sizes, max message size)

### SecurityPolicy None / User Token Anonymous Client
- [x] Connect + CreateSession + ActivateSession (anonymous), read `Integer` (`verifyReadInteger`)
- [ ] `getEndpoints` then `connect(endpoint)` with the discovered endpoint (SecurityPolicy None, Anonymous token)
- [ ] Client refuses an endpoint without `SecurityPolicy#None` when `allowSecurityPolicyNone = false`

### Core 2022 Client Facet – required
- [ ] Address Space Client NodeId IdTypes: read/write nodes with Numeric, String, Guid, Opaque ids
- [ ] Security Administration: `allowedUserTokenTypes` / `messageSecurityMode` / `allowSecurityPolicyNone` rejections
- [ ] Session Client Base: connect → read → disconnect → verify server-side session closed → reconnect
- [ ] Session Client General Service Behaviour: read unknown NodeId → `BadNodeIdUnknown` per result; `requestHandle` echoed; invalid authentication token → `ServiceFault`
- [ ] Session Client KeepAlive: idle longer than the server session timeout (short timeout via control channel), session survives
- [ ] Session Client Auto Reconnect: drop connection via control channel, next `read` succeeds; subscription continues delivering data

### Core 2022 Client Facet – optional
- [x] Session Client Detect Shutdown (`verifyDetectShutdown`, all 3 servers)
- [ ] Base Info Client Estimated Return Time: assert reconnect delay from `SecondsTillShutdown` (blocked on the spec-compliance fix in `session-client-detect-shutdown.md`)
- [ ] Base Info Client Currency: read `CurrencyUnit` property (note: unfixed ExtensionObject typeId 23498 bug on opcjs-server)
- [ ] Base Info Client Selection List: `getSelectionList()` on the selection-list node
- [ ] Base Services Client Diagnostics: `returnDiagnostics` on a read of a bad node, assert `diagnosticInfo` populated (where server supports it)
- [ ] Security Admin – Certificate Management: unknown server cert rejected by default, trusted after `addTrusted`, trust-on-first-use policy, `validateServerCertificate` callback
- [ ] Session Client Cancel: call slow method, `client.cancel(requestHandle)`, assert `cancelCount` / `BadRequestCancelledByClient`
- [ ] Session Client Impersonate: anonymous → username (uaNet/open62541 only), verify the new identity is used after reconnect
- [ ] Session Client Renew NodeIds: add namespace via control channel, assert `onNamespaceTableChanged` and `remapNodeId`

### Minimum UA 2025 Client Facet
- [ ] Discovery Client Configure Endpoint: connect using a configured endpoint URL; wrong URL/path fails with a clear error
- [ ] Security Default ApplicationInstance Certificate: client auto-generates own cert (assert files in `tmp/.../pki/own`) and server accepts it; browser variant uses IndexedDB

### Base Client Behaviour Facet
- [ ] Base Info Client Remote Nodes: browse remote tree from `ObjectsFolder`, follow continuation points on the >100-children folder
- [ ] Browse / Call: `client.browse` with filters, `client.callMethod` on `Add`
- [x] Subscription changing value (`verifySubscribeChangingNumber`)
- [ ] Subscription Client Multiple: two concurrent subscriptions with different publishing intervals, each receives its own data
- [ ] Subscription Client Publish Multiple: multiple outstanding Publish requests, acknowledgements, `keepAlive` messages when nothing changes, `deleteSubscription` stops notifications
- [ ] Security Certificate Administration: see "Certificate Management" above (shared test)
- [x] Discovery: `getEndpoints` (`verifyGetEndpoints`)
- [x] Write: Int64 array write + read back (`verifyReadWriteInt64Array`)

## 2. Server facets (opcjs RefServer vs opcjs-client and uaNet/RefClient)

Each test should exist in both `RefClientNode/tests/opcjs.test.ts` and `uaNet/RefClient/OpcjsRefServerTests.cs`.

### User Token Anonymous Server / SecurityPolicy None
- [x] Anonymous session established, read `Integer`
- [ ] Non-anonymous token (username) rejected with `BadIdentityTokenRejected`
- [ ] `SecurityPolicy#None` endpoint advertised and usable; unknown policy URI rejected on OpenSecureChannel

### Core 2022 Server Facet – required
- [x] Discovery Get Endpoints (`verifyGetEndpoints`); [ ] with `profileUris` / `localeIds` filters
- [ ] Discovery Find Servers Self: `FindServers` returns only the server itself, application URI matches
- [ ] Session Base: create → activate → close; session timeout expiry; `BadTooManySessions` above the limit (control channel); activate with invalid token
- [ ] Session General Service Behaviour: `requestHandle` echo, `timeoutHint`, invalid auth token → `BadSessionIdInvalid`, service called without session
- [ ] Attribute Read: all attributes for Variable/Object/Method nodes; `TimestampsToReturn` variants; `maxAge`; bad attribute id; `IndexRange` on arrays
- [ ] Address Space Full Array Only / Atomicity: read array atomically, multi-node write with partial failure
- [ ] Address Space Base: browse `Root`, `Objects`, `Types`, `Views`, `Server`; mandatory attributes present on each node class
- [ ] Base Info Core Structure 2: read `Server`, `NamespaceArray`, `ServerArray`, `ServerStatus` (incl. `State`, `BuildInfo`, `CurrentTime`)
- [ ] Base Info Server Capabilities 2: read `ServerCapabilities` (`ServerProfileArray`, `LocaleIdArray`, `MaxBrowseContinuationPoints`, `OperationLimits`)
- [ ] View Basic 2: browse with direction / reference type / `includeSubtypes` / `nodeClassMask` / `resultMask`; `BrowseNext` + release; `maxReferencesPerNode`
- [ ] View RegisterNodes: `RegisterNodes` → read via registered ids → `UnregisterNodes`
- [ ] View TranslateBrowsePath: `Objects/Server/ServerStatus/State`, unknown path (`BadNoMatch`), namespace-qualified path
- [ ] SecurityPolicy Support / Documentation Core Capacities: no ref test (policy None only; documentation CU)

### Core 2022 Server Facet – optional (implemented)
- [x] Attribute Write Values: `Int64Array` write + read back
- [ ] Attribute Write Values: every writable DataType, wrong type → `BadTypeMismatch`, read-only → `BadNotWritable`
- [ ] Attribute Write Index: write with `IndexRange` (sub-range, out-of-range → `BadIndexRangeNoData`)
- [ ] Attribute Write StatusCode & Timestamp: write `DataValue` with status/timestamps, read back
- [ ] Address Space AddIn Reference / AddIn DefaultInstanceBrowsename / Interfaces: browse `HasAddIn` / `HasInterface`, default instance browse name
- [ ] Address Space NonVolatile and Constant: read `NonVolatile` / `Constant` attributes of the demo nodes
- [ ] Base Info Core Views Folder, Locations Object, Namespace Metadata: browse and read the respective nodes
- [ ] Base Info Currency / Engineering Units / OptionSet / Selection List / ValueAsText: read the demo nodes, decode ExtensionObjects (verifies encoding ids 887, 23498, …)
- [ ] Base Info LocalTime: read `Server/LocalTime`
- [x] Base Info Estimated Return Time: shutdown state (`verifyDetectShutdown`, depends on spec fix above)
- [ ] Session Change User: `ActivateSession` on a live session with a new (anonymous) token; services keep working

### Embedded DataChange Subscription 2022 Server Facet
- [x] Subscription Basic / Publish Basic / Monitor Basic (happy path via `verifySubscribeChangingNumber`)
- [ ] Subscription Basic: Create / Modify / SetPublishingMode / Delete; revised intervals; lifetime and keep-alive counts; expiry → `StatusChangeNotification`
- [ ] Subscription Publish Basic: sequence numbers, acknowledgements, `Republish`, keep-alive messages, `BadSequenceNumberUnknown`
- [ ] Subscription PublishRequest Queue Overflow: >10 outstanding Publish requests → oldest returns `BadTooManyPublishRequests`; publish with no subscription → `BadNoSubscription`
- [ ] Monitor Basic: Create / Modify / SetMonitoringMode (Disabled/Sampling/Reporting) / Delete
- [ ] Monitor Items 2: many items per subscription, `queueSize` + `discardOldest`, revised sampling interval, invalid NodeId → `BadNodeIdUnknown` per item
- [ ] Monitor Value Change V2: `DataChangeFilter` triggers (Status / StatusValue / StatusValueTimestamp), absolute + percent deadband, `IndexRange`, `SemanticsChanged` bit
- [ ] Base Info Server Capabilities Subscriptions: read `MaxSubscriptions…`, `MaxMonitoredItems…` and assert limits are enforced

## 3. Cross-SDK matrix (acceptance, `doc/spec/interop-testing.md`)

- [x] opcjs-client vs uaNet / open62541 / opcjs RefServer (Node + Chromium)
- [x] uaNet client vs opcjs RefServer
- [ ] open62541 client vs opcjs RefServer
- [ ] All new shared tests wired for `RefClientWeb` (same specs, headless Chromium)
- [ ] Every new test executed from `npm run test:ref`

## Not testable in the ref suite (unit tests only)

Time Sync (OS-based), Documentation CUs, Security Admin / Certificate Administration server side (ConfigurationServer cert store), SecurityPolicy ECC / user-name-password server / diagnostics / role authorization (not implemented).
