# opcjs-server

OPC UA 1.05 server library for Node.js.

## Features

- WebSocket transport (via `ws`) with SecurityPolicy None
- Anonymous authentication
- Full in-memory address space: all eight NodeClasses (`Object`, `ObjectType`, `Variable`, `VariableType`, `ReferenceType`, `DataType`, `Method`, `View`), a forward/inverse `References` graph with the built-in ReferenceType hierarchy, `Root`/`Objects`/`Types`/`Views` entry points, and the standard `Server` object (`ServerStatus`, `ServiceLevel`, `Auditing`, `VendorServerInfo`, `ServerRedundancy`, `LocalTime`, `EstimatedReturnTime`, `ServerCapabilities`/`OperationLimits`)
- Service set support:
  - **Discovery**: `GetEndpoints`, `FindServers`
  - **Session**: `CreateSession`, `ActivateSession` (including re-activating with a new identity token), `CloseSession`
  - **Attribute**: `Read` (with `TimestampsToReturn`, `IndexRange`, `maxAge`), `Write` (with `IndexRange`, `AccessLevelEx.WriteFullArrayOnly` enforcement, and conditional StatusCode/Timestamp write-through)
  - **View**: `Browse`, `BrowseNext` (with continuation points), `TranslateBrowsePathsToNodeIds`, `RegisterNodes`, `UnregisterNodes`
  - **Subscription**: `CreateSubscription`, `ModifySubscription`, `DeleteSubscriptions`, `SetPublishingMode`, `Publish`, `Republish`
  - **MonitoredItem**: `CreateMonitoredItems`, `DeleteMonitoredItems`

## Quick start

```ts
import { OpcUaServer, AddressSpace } from 'opcjs-server'
import { NodeId, Variant, uaInt32 } from 'opcjs-base'

const addressSpace = new AddressSpace()
addressSpace.addVariable(
  NodeId.newNumeric(1, 1001),
  'Counter',
  NodeId.newNumeric(0, 6), // Int32
  Variant.newFrom(uaInt32(0)),
)

const server = new OpcUaServer({
  productName: 'MyServer',
  company: 'example',
  port: 4840,
})
server.addressSpace = addressSpace
await server.start()
console.log(`OPC UA server listening at ${server.endpointUrl}`)
```

## Certificate Management

`ConfigurationServer.certificateStore` accepts an `ICertificateStore` (from `opcjs-base`) so the server can present its own application instance certificate in `CreateSessionResponse.serverCertificate`:

```ts
import { ConfigurationServer } from 'opcjs-server'
import { createDefaultCertificateStore } from 'opcjs-base'

const certificateStore = await createDefaultCertificateStore({ pkiBaseDir: './pki' })
if (!(await certificateStore.getOwn())) {
  await certificateStore.generateOwn({ applicationUri: 'urn:example:MyServer', commonName: 'MyServer' })
}

const config = ConfigurationServer.fromOptions({ productName: 'MyServer', company: 'example', certificateStore })
```

When `certificateStore` is not configured, `serverCertificate` is `null` (SecurityPolicy None behaviour, unchanged). Validating incoming client certificates (chain/CRL/RBAC) is not implemented yet — see the Security Administration and Security Role Server Authorization conformance units.

## Server capacities

Documented values for the Core 2022 Server Facet's "Documentation – Core Capacities" conformance unit:

| Capacity | Value |
|----------|-------|
| Concurrent SecureChannels | Unbounded (one per accepted WebSocket connection) |
| Concurrent Sessions | 100 (`ServerCapabilities.MaxSessions`) |
| Browse/BrowseNext continuation points per session | Unbounded in practice; advertised as 10 (`ServerCapabilities.MaxBrowseContinuationPoints`) |
| Concurrent Subscriptions | Unbounded (no configured cap yet) |
| Concurrent Publish requests | Unbounded (no configured cap yet) |
| MonitoredItems per Subscription | Unbounded (no configured cap yet) |
| Retransmission queue size | Unbounded (no configured cap yet) |
| Sampled MonitoredItem queue size | Unbounded (no configured cap yet) |

## Conformance status

See the [doc/backlog/](../../doc/backlog/README.md) for the per-facet conformance breakdown. The **Core 2022 Server Facet** is fully implemented (15/15 required, 18/22 optional conformance units) — see [doc/backlog/core-2022-server-facet/README.md](../../doc/backlog/core-2022-server-facet/README.md).

## License

MIT
