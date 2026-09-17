# ref/opcjs

Reference OPC UA client built with `opcjs-client`/`opcjs-base`, used to
exercise reference/3rd-party OPC UA servers (starting with
[`ref/uaNet/RefServer`](../uaNet/README.md)).

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

### Running

```bash
cd ref/uaNet/RefServer && dotnet run &
cd ref/opcjs/RefClient
npm install
npm run dev
```
