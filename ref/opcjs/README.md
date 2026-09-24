# ref/opcjs

Reference OPC UA client built with `opcjs-client`/`opcjs-base`, used to
exercise reference/3rd-party OPC UA servers (starting with
[`ref/uaNet/RefServer`](../uaNet/README.md)), and a reference server built with
`opcjs-server`, used to exercise RefClient itself (and, over time, other
reference/3rd-party OPC UA clients).

Generated/received certificates are stored under the repo-root `tmp/` folder (see
[`../README.md`](../README.md#certificates)), via an explicit `certificateStore` passed
in `SecurityConfiguration` rather than the client's `./pki`-relative-to-cwd default.

## RefClient

Connects to `wss://localhost:62544/RefServer/` and performs interop tests
against RefServer. The trailing slash matters: the server always advertises
its endpoint path with a trailing `/`, and the client matches on exact path.

- `index.ts` — connects anonymously, reads the `Integer` variable exposed
  by RefServer, and prints a success message. More tests will be added
  here over time.
- `tests/uaNet.test.ts`, `tests/open62541.test.ts`, `tests/opcjs.test.ts` —
  one file per RefServer, each covering the Discovery Client Configure
  Endpoint conformance unit (`Client.getEndpoints()` returns a well-formed,
  non-empty `EndpointDescription[]` with matching host/port/path), the
  read-Integer interop check, and a subscribe check: every RefServer
  increments its `Integer` variable on its own every 200 ms (no
  client-initiated Write is required), and the test asserts
  `Client.subscribe()` delivers at least two distinct values.

### Running

```bash
cd ref/uaNet/RefServer && dotnet run &
cd ref/opcjs/RefClient
npm install
npm run dev
```

## RefServer

A minimal server built with `opcjs-server`, exposing a single writable
`Int32` variable (`Integer`) under the `Objects` folder, in a dedicated
custom namespace (`http://opcjs.dev/UA/RefServer/`, landing at ns=2),
matching `uaNet/RefServer` and `open62541/RefServer`. The server also
increments `Integer` on its own every 200 ms, so subscribing clients observe
a changing value without needing to issue a Write themselves (`opcjs-client`
does not implement the Write service yet).

`opcjs-server` only implements the WebSocket transport without TLS (see
[`packages/server/src/transport/webSocketListener.ts`](../../packages/server/src/transport/webSocketListener.ts)),
so its endpoint (`ws://localhost:62547/RefServer`) is unencrypted, unlike the
other two RefServers' `opc.wss://` endpoints. RefClient's
`tests/opcjsWebSocketPolyfill.ts` rewrites the `wss://` scheme `opcjs-client`
always dials back down to `ws://` for this one test.

- `index.ts` — starts the server on `ws://localhost:62547/RefServer` and
  prints "Server started." once ready.

### Running

```bash
cd ref/opcjs/RefServer
npm install
npm run dev
```

