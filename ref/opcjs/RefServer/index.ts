/**
 * RefServer — reference OPC UA server built with `opcjs-server`, used to
 * exercise `opcjs-client` (via ref/opcjs/RefClientNode and ref/opcjs/RefClientWeb) against a server built
 * from the opcjs stack itself, mirroring ref/uaNet/RefServer and
 * ref/open62541/RefServer.
 *
 * Exposes the address space shared by all RefServers (see addressSpace.ts and
 * "Common address space" in ref/README.md), in a dedicated custom namespace
 * (`http://opcjs.dev/UA/RefServer/`, landing at ns=2).
 *
 * `opcjs-server` only implements the WebSocket transport without TLS (see
 * packages/server/src/transport/webSocketListener.ts): its endpoint is
 * unencrypted `ws://`, not the `wss://` served by the other two RefServers.
 *
 * Also exposes a minimal, localhost-only HTTP control endpoint (see
 * `startControlServer`) that RefClient's ref-test suite uses to simulate a
 * server shutdown, drop connections, close sessions, add a namespace, etc. against
 * this shared instance — not part of the OPC UA protocol itself.
 */

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { AddressSpace, ConfigurationServer, OpcUaServer } from 'opcjs-server';
import { ServerStateEnum, Variant, uaDouble, uaInt32 } from 'opcjs-base';
import { buildAddressSpace } from './addressSpace.js';

const port = 62547;
const endpointPath = '/RefServer';
/** Port for the test-only control HTTP endpoint (see `startControlServer`). */
const controlPort = 62548;
/** Lowered from the 10 s default so tests can exercise session expiry quickly. */
const minSessionTimeoutMs = 1000;

type RefServer = { server: OpcUaServer; configuration: ConfigurationServer; addressSpace: AddressSpace };

/**
 * Executes one line of the control protocol shared by all RefServers
 * (see "Control channel" in ref/README.md) and returns the reply payload (may be empty).
 */
function executeCommand({ server, configuration, addressSpace }: RefServer, line: string): string {
  const [command, ...args] = line.trim().split(' ');
  switch (command) {
    case 'Shutdown': {
      const estimatedReturnTime = Number(args[0]);
      addressSpace.setServerState(ServerStateEnum.Shutdown, estimatedReturnTime > 0 ? new Date(estimatedReturnTime) : undefined);
      return '';
    }
    case 'Running':
      addressSpace.setServerState(ServerStateEnum.Running);
      return '';
    case 'DropConnections':
      server.dropAllConnections();
      return '';
    case 'CloseSessions':
      server.closeAllSessions();
      return '';
    case 'SessionCount':
      return String(server.sessionCount);
    case 'AddNamespace': {
      if (args.length !== 1) throw new Error('AddNamespace needs exactly one URI');
      return String(addressSpace.addNamespace(args[0]));
    }
    case 'SetMaxSessions': {
      const maxSessions = Number(args[0]);
      if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new Error('SetMaxSessions needs a positive integer');
      configuration.maxSessions = maxSessions;
      return '';
    }
    case 'SetMaxSessionTimeout': {
      const maxSessionTimeoutMs = Number(args[0]);
      if (!(maxSessionTimeoutMs >= minSessionTimeoutMs)) throw new Error(`SetMaxSessionTimeout needs a number >= ${minSessionTimeoutMs}`);
      configuration.maxSessionTimeoutMs = maxSessionTimeoutMs;
      return '';
    }
    default:
      throw new Error(`unknown command: ${line}`);
  }
}

/**
 * Starts a minimal HTTP server, bound to localhost only, that lets RefClient's ref-test
 * suite drive the running `OpcUaServer` instance:
 * - `POST /control` with a plain-text body holding one control-protocol line.
 * - `POST /server-state` with a JSON body `{ state: 'Shutdown' | 'Running', estimatedReturnTime?: number }`
 *   (epoch ms), equivalent to the `Shutdown <epochMs>` / `Running` lines.
 * Replies `200` with the command's payload, or `400` with the error message.
 */
function startControlServer(refServer: RefServer): HttpServer {
  const httpServer = createHttpServer((req, res) => {
    if (req.method !== 'POST' || (req.url !== '/control' && req.url !== '/server-state')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => {
      try {
        let line = body;
        if (req.url === '/server-state') {
          const { state, estimatedReturnTime } = JSON.parse(body) as {
            state: 'Running' | 'Shutdown';
            estimatedReturnTime?: number;
          };
          line = state === 'Shutdown' ? `Shutdown ${estimatedReturnTime ?? 0}` : 'Running';
        }
        res.writeHead(200).end(executeCommand(refServer, line));
      } catch (error) {
        res.writeHead(400).end(error instanceof Error ? error.message : String(error));
      }
    });
  });
  httpServer.listen(controlPort, '127.0.0.1');
  return httpServer;
}

export async function createServer(): Promise<RefServer> {
  const configuration = ConfigurationServer.fromOptions({
    productName: 'RefServer',
    company: 'opcjs',
    port,
    endpointPath,
  });
  configuration.minSessionTimeoutMs = minSessionTimeoutMs;

  const server = new OpcUaServer(configuration);
  const { addressSpace, integerVariable, triangleVariable } = buildAddressSpace();
  server.addressSpace = addressSpace;

  // Change the Integer and Triangle variables periodically so subscribing clients observe
  // changing values, without requiring a client-initiated Write.
  let counter = 0;
  let triangle = 0;
  let triangleStep = 1;
  const changeTimer = setInterval(() => {
    counter += 1;
    integerVariable.setValue(Variant.newFrom(uaInt32(counter)));

    triangle += triangleStep;
    if (triangle >= 100 || triangle <= 0) triangleStep = -triangleStep;
    triangleVariable.setValue(Variant.newFrom(uaDouble(triangle)));
  }, 200);
  changeTimer.unref();

  return { server, configuration, addressSpace };
}

async function main(): Promise<void> {
  const refServer = await createServer();
  const { server } = refServer;
  await server.start();
  const controlServer = startControlServer(refServer);

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
