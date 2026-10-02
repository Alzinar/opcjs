# ref/uaNet

Reference OPC UA servers built from scratch with the OPC Foundation
[UA-.NETStandard](https://github.com/OPCFoundation/UA-.NETStandard) stack
(`OPCFoundation.NetStandard.Opc.Ua.*` NuGet packages), used to exercise the
`opcjs` client against a real, independently-implemented server.

Generated/received certificates are stored under the repo-root `tmp/` folder (see
[`../README.md`](../README.md#certificates)), not in the OS temp directory.

## RefServer

A minimal server exposing the [common address space](../README.md#common-address-space) under the
`Objects` folder. `RefNodeManager` also changes `Integer` and `Triangle` on its own every 200 ms via a
`System.Threading.Timer`, so subscribing clients observe changing values without needing to issue a
Write themselves. Test-only control commands (see [Control channel](../README.md#control-channel),
port 62549) are served by `ControlServer.cs`.

- `Program.cs` — builds the `ApplicationConfiguration`, creates a
  self-signed application certificate on first run, registers the
  WebSocket transport binding, and starts the server on
  `opc.tcp://localhost:62543/RefServer` and
  `opc.wss://localhost:62544/RefServer`.
- `RefServerHost.cs` — `StandardServer` subclass that wires up the custom
  node manager.
- `RefNodeManager.cs` — `CustomNodeManager2` subclass that creates the common address space.
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

## RefClient

An xUnit test project that uses the same NuGet packages as `RefServer`
(`OPCFoundation.NetStandard.Opc.Ua.*` plus `UA.NETStandard.WebSocket`, with
`Opc.Ua.Client` added) to run the same checks as
[`ref/opcjs/RefClientNode/tests/opcjs.test.ts`](../opcjs/RefClientNode/tests/opcjs.test.ts)
— get endpoints, read `Integer`, subscribe to the changing `Integer`, detect a shutdown
announcement — against [`ref/opcjs/RefServer`](../opcjs/README.md#refserver).

- `OpcjsServerFixture.cs` — starts `ref/opcjs/RefServer` (`node dist/index.js`, build it
  first with `npm run build`) once per run, or uses an already running one when
  `OPCUA_EXTERNAL_SERVER=1` is set; builds the client `ApplicationConfiguration` (PKI under
  the repo-root `tmp/`).
- `TlsTerminatingProxy.cs` — the UA-.NETStandard WebSocket transport always dials `wss://`,
  while `opcjs-server` only speaks plain `ws://`, so the tests connect through a small
  TLS-terminating TCP proxy with a throw-away self-signed certificate. That certificate is
  added to the current user's trusted root store for the duration of the run (the transport
  offers no certificate-validation hook) and removed afterwards.
- `OpcjsRefServerTests.cs` — the tests.

### Running

```bash
(cd ref/opcjs/RefServer && npm install && npm run build)
cd ref/uaNet/RefClient
dotnet test
```

