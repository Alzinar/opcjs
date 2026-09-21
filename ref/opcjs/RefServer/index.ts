/**
 * RefServer — reference OPC UA server built with `opcjs-server`, used to
 * exercise `opcjs-client` (via ref/opcjs/RefClient) against a server built
 * from the opcjs stack itself, mirroring ref/uaNet/RefServer and
 * ref/open62541/RefServer.
 *
 * Exposes a single writable `Int32` variable ("Integer") under the `Objects`
 * folder, in namespace 1 (opcjs-server's default application namespace —
 * unlike the other two RefServers it does not register a dedicated custom
 * namespace URI).
 *
 * `opcjs-server` only implements the WebSocket transport without TLS (see
 * packages/server/src/transport/webSocketListener.ts): its endpoint is
 * unencrypted `ws://`, not the `wss://` served by the other two RefServers.
 */

import { AccessLevelFlags, AddressSpace, ObjectIds, OpcUaServer, ReferenceTypeIds } from 'opcjs-server';
import { NodeId, Variant, uaInt32 } from 'opcjs-base';

const port = 62547;
const endpointPath = '/RefServer';

export const integerNodeId = NodeId.newString(1, 'Integer');

function buildAddressSpace(): AddressSpace {
  const addressSpace = new AddressSpace();

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

  return addressSpace;
}

export async function createServer(): Promise<OpcUaServer> {
  const server = new OpcUaServer({
    productName: 'RefServer',
    company: 'opcjs',
    port,
    endpointPath,
  });
  server.addressSpace = buildAddressSpace();
  return server;
}

async function main(): Promise<void> {
  const server = await createServer();
  await server.start();

  // opcjs-server's endpointUrl getter labels the scheme "opc.wss://" even though the
  // listener never performs a TLS handshake — see the module doc comment above.
  console.log('Server started.');
  console.log(`  ${server.endpointUrl.replace(/^opc\.wss:\/\//, 'opc.ws://')}`);
  console.log('Press Ctrl+C to exit...');

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => resolve());
    process.on('SIGTERM', () => resolve());
  });

  await server.stop();
}

// Only run as a script when executed directly (e.g. `node index.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
