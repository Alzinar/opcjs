# ref/open62541

Reference OPC UA server built from scratch with the
[open62541](https://github.com/open62541/open62541) C library, used to
exercise the `opcjs` client against a real, independently-implemented server.

Generated/received certificates are stored under the repo-root `tmp/` folder (see
[`../README.md`](../README.md#certificates)), not in the OS temp directory.

## RefServer

A minimal server exposing the [common address space](../README.md#common-address-space) under the
`Objects` folder, in the custom namespace `http://opcjs.dev/UA/RefServer/` — mirroring
[`ref/uaNet/RefServer`](../uaNet/README.md)'s node tree. Repeated callbacks
(`UA_Server_addRepeatedCallback`) also change `Integer` and `Triangle` on their own every 200 ms, so
subscribing clients observe changing values without needing to issue a Write themselves. Test-only
control commands (see [Control channel](../README.md#control-channel), port 62551) are served by a
separate thread; since open62541 can't enumerate SecureChannels/Sessions, they are tracked from the
server's notification callback.

Listens on `opc.tcp://localhost:62545/RefServer` and
`opc.wss://127.0.0.1:62546/RefServer`. Only the latter is reachable by
`opcjs-client` (WebSocket transport only).

- `CMakeLists.txt` — fetches open62541 via CMake `FetchContent`, pinned to a
  specific master commit (see the comment in the file for why: the
  libwebsockets-backed WebSocket transport used here, `UA_ENABLE_LWS` /
  `config->webSocketEnabled`, is not yet part of any tagged open62541
  release), configured with `UA_ENABLE_ENCRYPTION=OPENSSL` and
  `UA_ENABLE_LWS=ON`.
- `src/main.c` — creates a self-signed certificate on first run (persisted
  under the shared `tmp/` PKI location), configures both listeners, and adds
  the `Integer` variable.

### Building

```bash
cd ref/open62541/RefServer
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

Requires `cmake`, `ninja-build`, `libssl-dev`, and `libwebsockets-dev`
(installed automatically via the dev container's `postCreateCommand` — see
`.devcontainer/devcontainer.json`).

### Running

```bash
cd ref/open62541/RefServer
./build/RefServer
```

The server accepts anonymous sessions with security policy `None` or one of
the several policies open62541 enables by default (`Basic256Sha256`,
`Aes128Sha256RsaOaep`, `Aes256Sha256RsaPss`, ...).

For opt-in username/password impersonation tests, set both `OPCUA_REF_USERNAME` and
`OPCUA_REF_PASSWORD` before starting the server or running `RefClientNode` tests. The server then
advertises a `UserName` token policy using `SecurityPolicy#None` and retains anonymous access.
This is test-only configuration; do not expose these endpoints on an untrusted network.

### Notable interop quirks (fixed in opcjs-client)

- libwebsockets binds its listener `iface` directly to a numeric IP or
  network device name — no DNS resolution — so `main.c` advertises
  `127.0.0.1` rather than `localhost` (which fails with
  `_lws_vhost_init_server_af: ... DOESN'T EXIST`).
- open62541 reports `EndpointDescription.endpointUrl` with a bare `wss://`
  scheme (no `opc.` prefix), unlike `ref/uaNet/RefServer`'s `opc.wss://`.
  `opcjs-client`'s session-endpoint matching (in `sessionService.ts`) now
  tolerates both forms.
- open62541 includes the server certificate in `EndpointDescription` even
  for the `None` security policy, so `opcjs-client` always validates it.
  `RefClient` opts into `unknownCertificatePolicy: 'trust'` (trust-on-first-use)
  for its certificate store, since these reference servers use disposable
  self-signed certificates.
