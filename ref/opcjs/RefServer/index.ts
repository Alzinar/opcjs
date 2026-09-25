/**
 * RefServer — reference OPC UA server built with `opcjs-server`, used to
 * exercise `opcjs-client` (via ref/opcjs/RefClient) against a server built
 * from the opcjs stack itself, mirroring ref/uaNet/RefServer and
 * ref/open62541/RefServer.
 *
 * Exposes a single writable `Int32` variable ("Integer") under the `Objects`
 * folder, in a dedicated custom namespace (`http://opcjs.dev/UA/RefServer/`,
 * landing at ns=2), matching the other two RefServers.
 *
 * `opcjs-server` only implements the WebSocket transport without TLS (see
 * packages/server/src/transport/webSocketListener.ts): its endpoint is
 * unencrypted `ws://`, not the `wss://` served by the other two RefServers.
 *
 * Also exposes a minimal, localhost-only HTTP control endpoint (see
 * `startControlServer`) that RefClient's ref-test suite uses to simulate a
 * server shutdown against this shared instance (Session Client Detect
 * Shutdown conformance unit) — not part of the OPC UA protocol itself.
 */

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { AccessLevelFlags, AddressSpace, ObjectIds, OpcUaServer, ReferenceTypeIds } from 'opcjs-server';
import type { VariableNode } from 'opcjs-server';
import { NodeId, ServerStateEnum, Variant, uaInt32 } from 'opcjs-base';

const port = 62547;
const endpointPath = '/RefServer';
const CUSTOM_NAMESPACE_URI = 'http://opcjs.dev/UA/RefServer/';
/** Port for the test-only shutdown-control HTTP endpoint (see `startControlServer`). */
const controlPort = 62548;

function buildAddressSpace(): { addressSpace: AddressSpace; integerNodeId: NodeId; integerVariable: VariableNode } {
  const addressSpace = new AddressSpace();
  const customNamespaceIndex = addressSpace.addNamespace(CUSTOM_NAMESPACE_URI);
  const integerNodeId = NodeId.newString(customNamespaceIndex, 'Integer');

  const integerVariable = addressSpace.addVariable(
    integerNodeId,
    'Integer',
    NodeId.newNumeric(0, 6), // Int32
    Variant.newFrom(uaInt32(0)),
    -1,
    undefined,
    AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
  );

  // Link the variable to the standard Objects folder so it shows up when browsing
  // from the root of the address space, matching the other RefServers.
  addressSpace.addReference(
    NodeId.newNumeric(0, ObjectIds.ObjectsFolder),
    NodeId.newNumeric(0, ReferenceTypeIds.Organizes),
    integerVariable.nodeId,
  );

  return { addressSpace, integerNodeId, integerVariable };
}

/**
 * Starts a minimal HTTP server, bound to localhost only, that lets RefClient's ref-test
 * suite simulate a server shutdown announcement against the running `OpcUaServer` instance:
 * `POST /server-state` with a JSON body `{ state: 'Shutdown' | 'Running', estimatedReturnTime?: number }`
 * (epoch ms) sets `Server/ServerStatus/State` (and, optionally, `EstimatedReturnTime`) via
 * `AddressSpace.setServerState`.
 */
function startControlServer(server: OpcUaServer): HttpServer {
  const httpServer = createHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/server-state') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => {
      try {
        const { state, estimatedReturnTime } = JSON.parse(body) as {
          state: 'Running' | 'Shutdown';
          estimatedReturnTime?: number;
        };
        const addressSpace = server.addressSpace;
        if (!(addressSpace instanceof AddressSpace)) {
          throw new Error('server.addressSpace is not an AddressSpace instance');
        }
        addressSpace.setServerState(
          state === 'Shutdown' ? ServerStateEnum.Shutdown : ServerStateEnum.Running,
          estimatedReturnTime !== undefined ? new Date(estimatedReturnTime) : undefined,
        );
        res.writeHead(200).end();
      } catch (error) {
        res.writeHead(400).end(error instanceof Error ? error.message : String(error));
      }
    });
  });
  httpServer.listen(controlPort, '127.0.0.1');
  return httpServer;
}

export async function createServer(): Promise<OpcUaServer> {
  const server = new OpcUaServer({
    productName: 'RefServer',
    company: 'opcjs',
    port,
    endpointPath,
  });
  const { addressSpace, integerVariable } = buildAddressSpace();
  server.addressSpace = addressSpace;

  // Increment the Integer variable periodically so subscribing clients observe a
  // changing value, without requiring a client-initiated Write.
  let counter = 0;
  const incrementTimer = setInterval(() => {
    counter += 1;
    integerVariable.setValue(Variant.newFrom(uaInt32(counter)));
  }, 200);
  incrementTimer.unref();

  return server;
}

async function main(): Promise<void> {
  const server = await createServer();
  await server.start();
  const controlServer = startControlServer(server);

  // opcjs-server's endpointUrl getter labels the scheme "opc.wss://" even though the
  // listener never performs a TLS handshake — see the module doc comment above.
  console.log('Server started.');
  console.log(`  ${server.endpointUrl.replace(/^opc\.wss:\/\//, 'opc.ws://')}`);
  console.log('Press Ctrl+C to exit...');

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => resolve());
    process.on('SIGTERM', () => resolve());
  });

  await new Promise<void>(resolve => controlServer.close(() => resolve()));
  await server.stop();
}

// Only run as a script when executed directly (e.g. `node index.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
