# opcjs-client

An OPC UA client library for TypeScript targeting the browser and Node.js, built on top of `opcjs-base`.

## Installation

```sh
npm install opcjs-client opcjs-base
```

## Quick Start

```ts
import { Client, ConfigurationClient, UserIdentity } from 'opcjs-client'
import { NodeId } from 'opcjs-base'

const config = ConfigurationClient.getSimple('MyApp', 'MyCompany')
const client = new Client('opc.tcp://localhost:4840', UserIdentity.newAnonymous(), config)

await client.connect()

// Read a node value
const results = await client.read([NodeId.newNumeric(0, 2258)]) // CurrentTime
console.log(results[0].value)

await client.disconnect()
```

## API

### `new Client(endpointUrl, identity, configuration)`

Creates a new client instance. Does not connect until `connect()` is called.

| Parameter | Type | Description |
|-----------|------|-------------|
| `endpointUrl` | `string` | OPC UA server endpoint (e.g. `opc.tcp://host:4840`) |
| `identity` | `UserIdentity` | Credentials used for `ActivateSession` |
| `configuration` | `ConfigurationClient` | Application description, encoder/decoder, and security settings |

### `client.getEndpoints(): Promise<EndpointDescription[]>`

Opens a transient SecureChannel to the configured `endpointUrl`, sends `GetEndpoints` (OPC UA Part 4 §5.4.4), and returns the advertised `EndpointDescription`s without creating a Session. Use this to let an operator or configuration pick a `SecurityPolicy`/`MessageSecurityMode` before calling `connect()` (Discovery Client Configure Endpoint conformance unit).

```ts
const endpoints = await client.getEndpoints()
const chosen = endpoints.find(e => e.securityPolicyUri?.endsWith('#None'))
await client.connect(chosen)
```

### `client.connect(endpoint?: EndpointDescription): Promise<void>`

Opens the WebSocket transport, establishes a TCP/SecureChannel, creates an OPC UA session, and starts the keep-alive timer.

When `endpoint` is provided (e.g. from `getEndpoints()` or a config file), its `endpointUrl` is used directly, bypassing the endpoint selection normally performed during connect. Omit it to use the `endpointUrl` passed to the `Client` constructor, as before.

Reconnects automatically on channel drops (Session Auto Reconnect, OPC UA Part 4 §5.7.1):
1. Attempts `ActivateSession` on the new channel to reuse the existing session.
2. Falls back to a full `CreateSession` + `ActivateSession` if reactivation fails.

### `client.disconnect(): Promise<void>`

Sends `CloseSession` (with `deleteSubscriptions=true`), closes the SecureChannel, and shuts down the WebSocket transport.

### `client.read(ids, options?): Promise<ReadValueResult[]>`

Reads the `Value` attribute of one or more nodes.

```ts
const [result] = await client.read([NodeId.newNumeric(0, 2258)])
// result.value          — the read value
// result.statusCode     — OPC UA StatusCode
// result.diagnosticInfo — populated when returnDiagnostics > 0
```

### `client.getSelectionList(nodeId): Promise<SelectionList | null>`

Reads `SelectionListType` metadata (OPC UA Part 5 §7.18) from a variable and exposes it to application code.

The method reads the variable's `HasProperty` references for:
- `Selections` (mandatory)
- `SelectionDescriptions` (optional)
- `RestrictToList` (optional)

It returns `null` when the variable does not expose a `Selections` property.

```ts
const list = await client.getSelectionList(nodeId)
if (list) {
  console.log(list.selections)
  console.log(list.selectionDescriptions.map(d => d.text))
  console.log('restrictToList:', list.restrictToList)
}
```

### `client.browse(nodeId, recursive?, options?): Promise<BrowseNodeResult[]>`

Browses the `HierarchicalReferences` of a node. Set `recursive` to `true` to traverse the full sub-tree.

Continuation points are handled automatically: all pages are fetched and merged before the promise resolves.

Each `BrowseNodeResult.isRemote()` reports whether the reference points to a Node on a different OPC UA server (`ExpandedNodeId.serverIndex > 0` or a `namespaceUri` set — Base Info Client Remote Nodes conformance unit). This client has no multi-server discovery registry, so recursive browse skips remote nodes rather than mis-resolving them as local; `resolveLocalNodeId()` (from `opcjs-client`) throws a `RemoteNodeError` if you attempt to resolve one directly. To access a remote Node, connect to its server with a separate, pre-configured `Client`.

### `client.callMethod(objectId, methodId, inputArguments?, options?): Promise<CallMethodResult>`

Calls an OPC UA method.

```ts
import { CallMethodArgument } from 'opcjs-client'

const result = await client.callMethod(
  NodeId.newNumeric(0, 1000),  // Object that owns the method
  NodeId.newNumeric(0, 1001),  // Method node
  [42, 'hello'] as CallMethodArgument[],
)
// result.values         — output argument values
// result.statusCode     — OPC UA StatusCode
// result.diagnosticInfo — populated when returnDiagnostics > 0
```

### `client.subscribe(ids, callback, options?): Promise<number>`

Creates an OPC UA subscription and monitored items, then starts (or joins) the Publish pipeline. Returns the server-assigned `subscriptionId`.

Can be called more than once per session: each call creates an independent Subscription with its own `publishingInterval`/`priority` (Subscription Client Multiple conformance unit) — e.g. a fast subscription for high-priority data and a slow one for the rest. All Subscriptions on a session share a single Publish pipeline that keeps multiple `Publish` requests outstanding at once (default 2) so the server is never blocked waiting for the next request (Subscription Client Publish Multiple conformance unit).

```ts
await client.subscribe(
  [NodeId.newNumeric(0, 2258)],
  (notifications) => {
    for (const { id, value } of notifications) {
      console.log(id, value)
    }
  },
  { requestedPublishingInterval: 1000 },
)

// A second, independent subscription with a slower publishing interval.
await client.subscribe(
  [NodeId.newNumeric(0, 2259)],
  (notifications) => { /* ... */ },
  { requestedPublishingInterval: 5000, priority: 0 },
)
```

`SubscriptionOptions` (all optional, server may revise):

| Field | Default | Description |
|-------|---------|-------------|
| `requestedPublishingInterval` | `2000` ms | Publishing interval |
| `requestedLifetimeCount` | `360000` | Subscription lifetime in publishing intervals |
| `requestedMaxKeepAliveCount` | `60000` | Keep-alive count |
| `maxNotificationsPerPublish` | `200` | `0` = no limit |
| `priority` | `1` | Priority relative to other subscriptions |
| `samplingInterval` | `-1` (use publishing interval) | Monitored item sampling interval |
| `queueSize` | server default | Per-item notification queue |

## Authentication

```ts
// Anonymous (default)
const identity = UserIdentity.newAnonymous()

// Username / password
const identity = UserIdentity.newWithUserName('user', 'pass')

// Issued token (e.g. OAuth / JWT)
const identity = UserIdentity.newWithIssuerToken(async (config) => {
  return { tokenData: new TextEncoder().encode(await fetchJwt(config)) }
})
```

## Security Configuration

Attach a `SecurityConfiguration` to the `ConfigurationClient` to restrict which security options are accepted:

```ts
import { UserTokenTypeEnum } from 'opcjs-base'

const config = ConfigurationClient.getSimple('MyApp', 'MyCompany')
config.securityConfiguration = {
  // Require authentication — reject anonymous connections
  allowedUserTokenTypes: [UserTokenTypeEnum.UserName],
  // Require an encrypted channel (throws until non-None policies are supported)
  allowSecurityPolicyNone: false,
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `allowedUserTokenTypes` | all types | Token types the client will accept |
| `allowSecurityPolicyNone` | `true` | Allow unencrypted SecurityPolicy None channels |
| `messageSecurityMode` | any | Required `MessageSecurityMode` |
| `applicationInstanceCertificate` | — | DER-encoded site-specific ApplicationInstanceCertificate (Security Certificate Administration conformance unit). Sent proactively as `clientCertificate` on every `CreateSession`; also used as the OPC UA 1.0 fallback when a server rejects an uncertified session. |
| `privateKey` | — | DER-encoded PKCS#8 private key matching `applicationInstanceCertificate` (reserved for future use until a signing security policy is implemented) |
| `certificateStore` | lazily created default | An `ICertificateStore` managing this client's own certificate and trusted/rejected CA lists (Security Admin – Certificate Management conformance unit) |
| `validateServerCertificate` | `store.validate(cert, uri)` | Overridable hook to validate the server certificate from `CreateSessionResponse` |

> **Security note:** `allowSecurityPolicyNone: true` (the default) allows cleartext communication. Set it to `false` once non-None security policies are available in this client implementation.

## Certificate Management

`opcjs-base` provides an isomorphic `ICertificateStore` (OPC UA Part 6, §6.2) that persists application instance certificates and trusted/rejected CA lists in the standard OPC UA PKI directory layout:

```ts
import { createDefaultCertificateStore } from 'opcjs-base'

// Picks FileSystemCertificateStore under Node.js, IndexedDbCertificateStore in a browser.
const store = await createDefaultCertificateStore({ pkiBaseDir: './pki' })
await store.generateOwn({ applicationUri: config.applicationUri, commonName: 'MyApp' })
await store.addTrusted(caCertDer)
```

When `securityConfiguration.certificateStore` is not set, `Client` lazily creates and reuses a default store on first connect. If that default store has no own certificate yet, `connect()` automatically generates a self-signed `ApplicationInstanceCertificate` (subject taken from `ConfigurationClient.applicationUri` / `applicationName`) so every deployed instance has a valid default identity without any manual installation step (Security Default ApplicationInstance Certificate conformance unit). A caller-supplied `certificateStore` is assumed to already be provisioned and is left untouched. `securityConfiguration.validateServerCertificate` lets you override how the server's certificate (received in `CreateSessionResponse`) is validated — e.g. for pinning or extra OCSP checks — without reimplementing the store; it defaults to delegating to `ICertificateStore.validate()`. On rejection, `connect()` throws `ServerCertificateRejectedError`.
