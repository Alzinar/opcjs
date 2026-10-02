# ref/opcjs

Reference OPC UA clients built with `opcjs-client`/`opcjs-base` — one running in
Node.js (`RefClientNode`), one running the same tests in a headless browser
(`RefClientWeb`) — used to exercise reference/3rd-party OPC UA servers (starting with
[`ref/uaNet/RefServer`](../uaNet/README.md)), and a reference server built with
`opcjs-server`, used to exercise the clients themselves (and, over time, other
reference/3rd-party OPC UA clients).

Generated/received certificates are stored under the repo-root `tmp/` folder (see
[`../README.md`](../README.md#certificates)), via an explicit `certificateStore` passed
in `SecurityConfiguration` rather than the client's `./pki`-relative-to-cwd default.

## RefClientNode

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
- `tests/shared.ts` — the platform-neutral assertions used by the test files.
- `tests/platform.ts` — the Node.js-specific bits (file-system PKI location,
  control-channel access, `wss://` → `ws://` downgrade for the opcjs RefServer).
  `RefClientWeb` swaps in its own implementation of this module.

### Running

```bash
cd ref/uaNet/RefServer && dotnet run &
cd ref/opcjs/RefClientNode
npm install
npm run dev
```

## RefClientWeb

Runs every test spec of `RefClientNode/tests` unchanged, but inside headless
Chromium, using Vitest's browser mode with the Playwright provider. There is
no UI; `npm test` launches the browser, runs the specs and exits.

- `vitest.config.ts` — points Vitest at `../RefClientNode/tests`, reuses its
  `globalSetup.ts` (which starts/stops all RefServers), and aliases the specs'
  `./platform.js` import to `tests/platform.ts`.
- `tests/platform.ts` — the browser implementation: the OPC UA application
  certificate lives in IndexedDB, the RefServers' test-only control channels
  (raw TCP / HTTP without CORS headers, unreachable from a page) are driven
  through Vitest browser commands executed in Node, and the `wss://` → `ws://`
  downgrade wraps the browser's native `WebSocket`.
- `tlsClientCertificate.ts` — `uaNet/RefServer`'s Kestrel `wss://` listener
  requests an (optional) TLS client certificate; Chromium cancels a WebSocket
  opening handshake when that happens and no certificate gets selected, so
  Playwright presents an OPC UA-style certificate (generated with
  `opcjs-base`) for `https://localhost:62544`.
- The RefServers use self-signed TLS certificates; Chromium is launched with
  `--ignore-certificate-errors`.

### Running

```bash
cd ref/opcjs/RefClientWeb
npm install
npm run install:browser   # downloads Playwright's headless Chromium
npm test
```

## RefServer

A minimal server built with `opcjs-server`, exposing the
[common address space](../README.md#common-address-space) (minus the `Methods` object, as `opcjs-server`
has no Call service yet) under the `Objects` folder, in a dedicated custom namespace
(`http://opcjs.dev/UA/RefServer/`, landing at ns=2), matching `uaNet/RefServer` and
`open62541/RefServer`. The server also changes `Integer` and `Triangle` on its own every 200 ms, so
subscribing clients observe changing values without needing to issue a Write themselves. Test-only
control commands (see [Control channel](../README.md#control-channel), HTTP port 62548) are served by
`index.ts`; the address space is built in `addressSpace.ts`.

`opcjs-server` only implements the WebSocket transport without TLS (see
[`packages/server/src/transport/webSocketListener.ts`](../../packages/server/src/transport/webSocketListener.ts)),
so its endpoint (`ws://localhost:62547/RefServer`) is unencrypted, unlike the
other two RefServers' `opc.wss://` endpoints. The clients' `downgradeWssToWs()`
(`tests/platform.ts`) rewrites the `wss://` scheme `opcjs-client`
always dials back down to `ws://` for this one test.

- `index.ts` — starts the server on `ws://localhost:62547/RefServer` and
  prints "Server started." once ready.

### Running

```bash
cd ref/opcjs/RefServer
npm install
npm run dev
```

