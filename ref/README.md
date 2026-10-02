# ref

Reference implementations used for cross-SDK OPC UA interoperability testing.

- [`uaNet/RefServer`](uaNet/README.md) — a minimal OPC UA server built from scratch with
  the OPC Foundation UA-.NETStandard NuGet packages, exposing the [common address space](#common-address-space)
  over both `opc.tcp://` and `opc.wss://`.
- [`open62541/RefServer`](open62541/README.md) — the same address space,
  built from scratch with the open62541 C library, over both `opc.tcp://` and `opc.wss://`.
- [`opcjs/RefServer`](opcjs/README.md#refserver) — the same address space (minus the `Methods`
  object), built with `opcjs-server`, over an unencrypted `ws://` (no TLS support yet).
- [`opcjs/RefClientNode`](opcjs/README.md#refclientnode) — a minimal OPC UA client built with
  `opcjs-client`, running in Node.js, used to exercise all RefServers (and, over time, other
  3rd-party reference servers/clients).
- [`opcjs/RefClientWeb`](opcjs/README.md#refclientweb) — runs the very same test specs as
  `RefClientNode`, but inside a headless Chromium (Vitest browser mode + Playwright).
- [`uaNet/RefClient`](uaNet/README.md#refclient) — a UA-.NETStandard (xUnit) client running the
  same checks as `RefClientNode`'s `opcjs.test.ts`, against `opcjs/RefServer`.

## Common address space

All three RefServers expose the same nodes in the custom namespace `http://opcjs.dev/UA/RefServer/`
(ns=2, string NodeIds equal to the browse name unless noted). Everything is writable unless noted.
The expected initial values are encoded in
[`opcjs/RefClientNode/tests/commonAddressSpace.ts`](opcjs/RefClientNode/tests/commonAddressSpace.ts),
which every server is verified against (`common address space` test in each `*.test.ts`).

| Node(s) | Notes |
|---------|-------|
| `Integer` (Int32), `Int64Array` (Int64[]) | `Integer` increments by 1 every 200 ms. Both directly below `Objects`. |
| `Triangle` (Double) | Triangle wave 0 → 100 → 0, step 1 every 200 ms. |
| `Static_Int32` (Int32 = 7) | Never changes on its own (keep-alive / no-data-change tests). |
| `Scalars/Scalar_<Type>`, `Arrays/Array_<Type>` | One scalar and one 2-element array per BuiltInType from `Boolean` to `LocalizedText` (21 types). `Scalar_*` holds the array's first element. |
| `Scalars/Scalar_Variant`, `_ExtensionObject` (a `Range`), `_DataValue`, `_DiagnosticInfo` | DataTypes `BaseDataType`, `Structure`, `DataValue`, `DiagnosticInfo`. |
| `Arrays/LargeDoubleArray` | 20 000 doubles — larger than one chunk. |
| `NodeIds/Id_Numeric`, `Id_String`, `Id_Guid`, `Id_Opaque` | NodeIds `ns=2;i=1000`, `ns=2;s=Id_String`, `ns=2;g=1b4e28ba-2fa1-11d2-883f-b9a761bde3fb`, `ns=2;b=AQIDBA==`. Int32 values 1–4. |
| `ReadOnly_Int32`, `WriteOnly_Int32`, `Timestamped_Int32`, `Historizing_Int32` | AccessLevel `CurrentRead`; `CurrentWrite`; read/write + `StatusWrite` + `TimestampWrite`; `CurrentRead` + `HistoryRead` with `Historizing = true`. |
| `ManyChildren/Child_000` … `Child_149` | 150 variables, for continuation points / `BrowseNext`. |
| `Temperature` + `EngineeringUnits` (`EUInformation`, °C) + `EURange` (0–100) | Properties of the variable (`s=Temperature.EngineeringUnits`, …). |
| `Price` + `CurrencyUnit` (`CurrencyUnitType`, EUR) | |
| `Mode` + `Selections`, `SelectionDescriptions`, `RestrictToList` | Selection list (Base Info Selection List). |
| `Methods` object with `Add(a, b) → sum` and `Slow(ms)` | uaNet and open62541 only: `opcjs-server` has no Call service yet. `Slow` waits `ms` milliseconds, asynchronously, for Cancel tests. |

Server-facet–only nodes (`PiConstant`, `StatusFlags`, `TrafficLight`, `Locations`, `Namespaces`,
interface types, AddIn reference, …) are built into `opcjs-server`'s own address space (ns=1) and are
not mirrored on the other servers.

## Control channel

Each RefServer also listens on a localhost-only, test-only control port (not part of OPC UA) that lets
tests manipulate the running server. The protocol is one command line per request; the reply is `OK`
(optionally followed by a payload) or `ERROR <message>`.

| Server | Transport | Port |
|--------|-----------|------|
| `opcjs/RefServer` | HTTP `POST /control` with the line as body (reply payload is the response body); `POST /server-state` takes JSON `{ state, estimatedReturnTime? }` | 62548 |
| `uaNet/RefServer` | raw TCP | 62549 |
| `open62541/RefServer` | raw TCP | 62551 |

| Command | Effect | Reply payload |
|---------|--------|---------------|
| `Shutdown <epochMs>` / `Running` | Announce / revert a server shutdown in `ServerStatus/State` | — |
| `DropConnections` | Abruptly close every open SecureChannel/connection; sessions stay alive | — |
| `CloseSessions` | Close every session server-side without notifying clients | — |
| `SessionCount` | Number of sessions currently open | the count |
| `AddNamespace <uri>` | Append a URI to `Server/NamespaceArray` | its index |
| `SetMaxSessions <n>` | Limit concurrent sessions (default 100) | — |
| `SetMaxSessionTimeout <ms>` | Upper bound the client's requested session timeout (60 s) is revised to (default 1 h) | — |

`DropConnections` also severs connections that earlier tests of the same file left open, so its test
runs first in each test file. The tests use `sendControlCommandTcp`/`sendControlCommandHttp`
(`tests/serverControl.ts`, `tests/platform.ts`).

## Certificates

Every reference implementation generates/receives its certificates under a single
gitignored `/tmp/` folder at the repository root (see `.gitignore`), mirroring the source
tree: e.g. `tmp/ref/uaNet/RefServer/pki`, `tmp/ref/opcjs/RefClientNode/pki`. Delete `/tmp/` at
any time to reset every implementation's PKI state. `RefClientWeb` keeps its OPC UA application
certificate in the browser's IndexedDB instead (a fresh, empty profile per run).

## Running the test suite

The tests live in `ref/opcjs/RefClientNode/tests` (Vitest) and are executed twice: once in
Node.js by `RefClientNode` and once in headless Chromium by `RefClientWeb`. A `globalSetup.ts`
(shared by both) automatically
starts `uaNet/RefServer` (`dotnet run`), the prebuilt `open62541/RefServer` binary, and the
built `opcjs/RefServer` (`node dist/index.js`) before the suite and stops them afterward —
no manual server setup is required.

### One-shot: build + run everything + clean up

From the repository root:

```bash
npm run test:ref
```

Runs [`ref/test.sh`](test.sh), which builds `opcjs-base`/`opcjs-client`/`opcjs-server`
(via Nx, so a step is skipped when already up to date), builds `uaNet/RefServer`
(`dotnet build`), `open62541/RefServer` (`cmake`/`ninja`, skipped once already configured),
and `opcjs/RefServer` (`npm install && npm run build`), installs `RefClientNode`'s and
`RefClientWeb`'s dependencies (plus Playwright's headless Chromium), and runs both test
suites one after the other — then always stops any leftover server process and deletes the
generated-certificates folder (`/tmp/`) afterward, whether the tests passed or failed. The
script fails if any suite fails (the three Node/browser/.NET runs: `RefClientNode`, `RefClientWeb`, `uaNet/RefClient`).

Headless Chromium needs a few system libraries. If the browser fails to launch, install them
once with (requires root):

```bash
cd ref/opcjs/RefClientWeb
sudo npx playwright install-deps chromium
```

### Run all tests

```bash
cd ref/opcjs/RefClientNode   # or ref/opcjs/RefClientWeb
npm install   # first time only
npm run install:browser       # RefClientWeb only, first time only
npm test
```

### Run one specific test

Pass a path (or a substring of it) to `vitest run` to only run matching test files:

```bash
cd ref/opcjs/RefClientNode   # or ref/opcjs/RefClientWeb
npm test -- tests/uaNet.test.ts
```

Use `-t "<name>"` to filter by test name instead of file:

```bash
npm test -- -t "reads the Integer variable"
```

### Watch mode

```bash
npm run test:dev
```

### Running against a server you started yourself

To debug `RefServer` manually (e.g. attach a debugger, watch its logs) instead of letting
the tests manage its lifecycle, start it in one terminal:

```bash
cd ref/uaNet/RefServer
dotnet run
```

and run the tests against it in another, skipping the automatic start/stop:

```bash
cd ref/opcjs/RefClientNode   # or ref/opcjs/RefClientWeb
OPCUA_EXTERNAL_SERVER=1 npm test
```

Set `OPCUA_SERVER_LOGGING=1` to also print RefServer's own console output interleaved with
the test run when it *is* managed automatically.
