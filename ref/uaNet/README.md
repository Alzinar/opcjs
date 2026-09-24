# ref/uaNet

Reference OPC UA servers built from scratch with the OPC Foundation
[UA-.NETStandard](https://github.com/OPCFoundation/UA-.NETStandard) stack
(`OPCFoundation.NetStandard.Opc.Ua.*` NuGet packages), used to exercise the
`opcjs` client against a real, independently-implemented server.

Generated/received certificates are stored under the repo-root `tmp/` folder (see
[`../README.md`](../README.md#certificates)), not in the OS temp directory.

## RefServer

A minimal server exposing a single writable `Int32` variable node
(`Integer`) under the `Objects` folder. `RefNodeManager` also increments
`Integer` on its own every 200 ms via a `System.Threading.Timer`, so
subscribing clients observe a changing value without needing to issue a
Write themselves.

- `Program.cs` — builds the `ApplicationConfiguration`, creates a
  self-signed application certificate on first run, registers the
  WebSocket transport binding, and starts the server on
  `opc.tcp://localhost:62543/RefServer` and
  `opc.wss://localhost:62544/RefServer`.
- `RefServerHost.cs` — `StandardServer` subclass that wires up the custom
  node manager.
- `RefNodeManager.cs` — `CustomNodeManager2` subclass that creates the
  `Integer` variable.
- `WebSockets/` — `opc.wss://` transport listener/channel implementation
  (`ITransportListener`/`ITransportChannel` plugged into the SDK's static
  `TransportBindings` registry), hosted over Kestrel/ASP.NET Core. Needed
  because `opcjs-client` only speaks OPC UA over WebSocket, never raw
  `opc.tcp://`. The Kestrel HTTPS listener reuses the same OPC UA
  application instance certificate as its TLS certificate.
- `OpcChannelOriginTracker.cs` — tracks whether a WebSocket channel
  originated from a loopback address; a dependency of the WebSocket
  listener, unused otherwise in this minimal server.

### Running

```bash
cd ref/uaNet/RefServer
dotnet run
```

The server accepts anonymous sessions with security policy `None` or
`Basic256Sha256` (Sign / SignAndEncrypt), on both endpoints.

