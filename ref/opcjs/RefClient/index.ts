/**
 * RefClient — reference OPC UA client used to exercise reference servers
 * (RefServer and other 3rd-party servers) against the opcjs client library.
 *
 * For now it only performs a single "read integer" test: connect, read the
 * `Integer` variable exposed by RefServer, and report success. Further
 * interop tests will be added to this project over time.
 */

import { Client, ConfigurationClient, UserIdentity } from 'opcjs-client';
import { NodeId, StatusCode, Variant, createDefaultCertificateStore } from 'opcjs-base';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const endpointUrl = 'wss://localhost:62544/RefServer/';
// RefServer namespace index for its custom "http://opcjs.dev/UA/RefServer/" namespace.
export const integerNodeId = NodeId.newString(2, 'Integer');

// ref/open62541/RefServer's wss:// endpoint (libwebsockets binds directly to a
// numeric IP, "localhost" is rejected — see ref/open62541/RefServer/src/main.c).
export const open62541EndpointUrl = 'wss://127.0.0.1:62546/RefServer';
export const open62541IntegerNodeId = NodeId.newString(2, 'Integer');

// ref/opcjs/RefServer's endpoint. opcjs-server only implements the WebSocket
// transport without TLS (see packages/server/src/transport/webSocketListener.ts),
// so this is really served over unencrypted ws://; tests/opcjsWebSocketPolyfill.ts
// rewrites the wss:// scheme opcjs-client always dials back down to ws:// for this
// endpoint. Its Integer node lives in its own custom namespace
// ("http://opcjs.dev/UA/RefServer/", ns=2), matching the other two RefServers.
export const opcjsEndpointUrl = 'wss://localhost:62547/RefServer';
export const opcjsIntegerNodeId = NodeId.newString(2, 'Integer');

// Shared, easily-gitignored location for every ref/ implementation's generated/received
// certificates (see /tmp/ in .gitignore).
const pkiBaseDir = path.resolve(__dirname, '../../..', 'tmp', 'ref', 'opcjs', 'RefClient', 'pki');

async function createClientFor(endpoint: string): Promise<Client> {
  const configuration = ConfigurationClient.getSimple('RefClient', 'opcjs');
  // Reference servers use self-signed certificates; trust them on first use rather
  // than requiring them to be pre-installed in the trust list.
  const certificateStore = await createDefaultCertificateStore({ pkiBaseDir, unknownCertificatePolicy: 'trust' });

  // Supplying our own certificateStore opts out of Client's automatic own-certificate
  // generation (it assumes a caller-supplied store is already provisioned), so replicate
  // that step here to keep the previous behaviour, just pointed at the shared tmp dir.
  if (!(await certificateStore.getOwn())) {
    await certificateStore.generateOwn({
      applicationUri: configuration.applicationUri,
      commonName: configuration.applicationName,
    });
  }

  configuration.securityConfiguration = { certificateStore };
  return new Client(endpoint, configuration, UserIdentity.newAnonymous());
}

export async function createClient(): Promise<Client> {
  return createClientFor(endpointUrl);
}

export async function createOpen62541Client(): Promise<Client> {
  return createClientFor(open62541EndpointUrl);
}

export async function createOpcjsClient(): Promise<Client> {
  return createClientFor(opcjsEndpointUrl);
}

/** Reads the Value attribute of `nodeId` from `client` and returns it. */
export async function readInteger(client: Client, nodeId: NodeId = integerNodeId): Promise<number> {
  const results = await client.read([nodeId]);
  const result = results[0];

  if (result?.statusCode !== StatusCode.Good) {
    throw new Error(`Read of Integer failed with statusCode ${result?.statusCode}`);
  }

  // The Value attribute is delivered as a Variant; unwrap its inner value.
  return (result.value as Variant).value as number;
}

async function main(): Promise<void> {
  // RefServer uses a self-signed certificate for its TLS/WebSocket listener.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const client = await createClient();

  try {
    await client.connect();
    console.log('Connected successfully!');

    const value = await readInteger(client);
    console.log(`Success: read Integer = ${value}`);
  } finally {
    await client.disconnect();
  }
}

// Only run as a script when executed directly (e.g. `node index.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
