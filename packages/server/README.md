# opcjs-server

OPC UA 1.05 server library for Node.js.

## Features

- WebSocket transport (via `ws`) with SecurityPolicy None
- Anonymous authentication
- In-memory address space with mandatory server nodes pre-populated
- Service set support:
  - **Discovery**: `GetEndpoints`, `FindServers`
  - **Session**: `CreateSession`, `ActivateSession`, `CloseSession`
  - **Attribute**: `Read` (with `TimestampsToReturn`)
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

## Conformance status

See the [doc/backlog/](../../doc/backlog/README.md) for the per-facet conformance breakdown.

## License

MIT
