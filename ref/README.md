# ref

Reference implementations used for cross-SDK OPC UA interoperability testing.

- [`uaNet/RefServer`](uaNet/README.md) — a minimal OPC UA server built from scratch with
  the OPC Foundation UA-.NETStandard NuGet packages, exposing a single `Integer` variable
  over both `opc.tcp://` and `opc.wss://`.
- [`open62541/RefServer`](open62541/README.md) — the same minimal `Integer` variable,
  built from scratch with the open62541 C library, over both `opc.tcp://` and `opc.wss://`.
- [`opcjs/RefServer`](opcjs/README.md#refserver) — the same minimal `Integer` variable,
  built with `opcjs-server`, over an unencrypted `ws://` (no TLS support yet).
- [`opcjs/RefClient`](opcjs/README.md) — a minimal OPC UA client built with `opcjs-client`,
  used to exercise both RefServers (and, over time, other 3rd-party reference servers/clients).

## Certificates

Every reference implementation generates/receives its certificates under a single
gitignored `/tmp/` folder at the repository root (see `.gitignore`), mirroring the source
tree: e.g. `tmp/ref/uaNet/RefServer/pki`, `tmp/ref/opcjs/RefClient/pki`. Delete `/tmp/` at
any time to reset every implementation's PKI state.

## Running the test suite

The tests live in `ref/opcjs/RefClient/tests` (Vitest). A `globalSetup.ts` automatically
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
and `opcjs/RefServer` (`npm install && npm run build`), installs `RefClient`'s dependencies,
and runs its full test suite — then always stops any leftover server process and deletes the
generated-certificates folder (`/tmp/`) afterward, whether the tests passed or failed.

### Run all tests

```bash
cd ref/opcjs/RefClient
npm install   # first time only
npm test
```

### Run one specific test

Pass a path (or a substring of it) to `vitest run` to only run matching test files:

```bash
cd ref/opcjs/RefClient
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
cd ref/opcjs/RefClient
OPCUA_EXTERNAL_SERVER=1 npm test
```

Set `OPCUA_SERVER_LOGGING=1` to also print RefServer's own console output interleaved with
the test run when it *is* managed automatically.
