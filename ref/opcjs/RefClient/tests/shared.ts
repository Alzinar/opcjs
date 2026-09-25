import { describe, expect, it } from 'vitest';
import { Client, ConfigurationClient, UserIdentity } from 'opcjs-client';
import { createDefaultCertificateStore, NodeId, StatusCode, Variant } from 'opcjs-base';
import path from 'path';
import net from 'node:net';


// Shared, easily-gitignored location for every ref/ implementation's generated/received
// certificates (see /tmp/ in .gitignore). __dirname is tests/, one level deeper than
// the repo-root-relative path expects, hence the extra '..'.
const pkiBaseDir = path.resolve(__dirname, '../../../..', 'tmp', 'ref', 'opcjs', 'RefClient', 'pki');

export async function createClientFor(endpoint: string, configure?: (configuration: ConfigurationClient) => void): Promise<Client> {
    const configuration = ConfigurationClient.getSimple('RefClient', 'opcjs');
    configure?.(configuration);
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

/** Connects `client`, reads `nodeId`'s Integer variable, and asserts the result. */
export async function verifyReadInteger(client: Client): Promise<void> {
    try {
        await client.connect();

        const integerNodeId = NodeId.newString(2, 'Integer');
        const value = await readInteger(client, integerNodeId);

        expect(typeof value).toBe('number');
    } finally {
        await client.disconnect();
    }
}

/** Reads the Value attribute of `nodeId` from `client` and returns it. */
async function readInteger(client: Client, nodeId: NodeId): Promise<number> {
    const results = await client.read([nodeId]);
    const result = results[0];

    if (result?.statusCode !== StatusCode.Good) {
        throw new Error(`Read of Integer failed with statusCode ${result?.statusCode}`);
    }

    // The Value attribute is delivered as a Variant; unwrap its inner value.
    return (result.value as Variant).value as number;
}

/**
 * Connects `client`, subscribes to the Integer variable (which every RefServer
 * increments on its own every 200 ms), and asserts that at least two distinct
 * values are delivered to the subscription callback.
 */
export async function verifySubscribeChangingNumber(client: Client): Promise<void> {
    try {
        await client.connect();

        const integerNodeId = NodeId.newString(2, 'Integer');
        const received: number[] = [];

        await new Promise<void>((resolve, reject) => {
            void client.subscribe(
                [integerNodeId],
                (updates) => {
                    for (const update of updates) {
                        received.push(update.value as number);
                    }
                    if (new Set(received).size >= 2) {
                        resolve();
                    }
                },
                { requestedPublishingInterval: 200 },
            ).catch(reject);
        });

        expect(new Set(received).size).toBeGreaterThanOrEqual(2);
    } finally {
        await client.disconnect();
    }
}

/**
 * Discovery Client Configure Endpoint conformance unit (OPC UA Part 4, §5.4.3):
 * asserts `client.getEndpoints()` returns a well-formed, non-empty
 * `EndpointDescription[]` that includes the endpoint `client` is connected to.
 */
export async function verifyGetEndpoints(client: Client, endpointUrl: string): Promise<void> {
    const endpoints = await client.getEndpoints();

    expect(endpoints.length).toBeGreaterThan(0);
    for (const endpoint of endpoints) {
        expect(typeof endpoint.endpointUrl).toBe('string');
        expect(endpoint.endpointUrl).toBeTruthy();
        expect(typeof endpoint.securityPolicyUri).toBe('string');
        expect(endpoint.server?.applicationUri).toBeTruthy();
    }
    // RefServers advertise opc.tcp:// / opc.wss:// endpointUrls that differ from the
    // wss:// scheme opcjs-client dials, so match on host/port/path instead of the full URL.
    const { port } = new URL(endpointUrl.replace(/^wss:/, 'https:'));
    expect(endpoints.some((e) => e.endpointUrl?.includes(`:${port}`) && e.endpointUrl?.includes('/RefServer'))).toBe(true);
}

/**
 * Flips a RefServer's `Server/ServerStatus/State` via a raw-TCP, line-based test-only control
 * listener: connects to `port`, sends a single line (`Shutdown <epochMs>` or `Running`), and
 * expects a reply starting with `OK`. Used by servers whose control channel is a plain TCP
 * listener (ref/uaNet/RefServer's ControlServer.cs, ref/open62541/RefServer's controlServerThread)
 * rather than HTTP. Not part of the OPC UA protocol itself.
 */
export async function setServerStateTcp(
    port: number,
    state: 'Running' | 'Shutdown',
    estimatedReturnTime?: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
            socket.write(state === 'Shutdown' ? `Shutdown ${estimatedReturnTime ?? 0}\n` : 'Running\n');
        });
        let data = '';
        socket.on('data', (chunk) => { data += chunk.toString(); });
        socket.on('error', reject);
        socket.on('close', () => {
            if (data.trim().startsWith('OK')) resolve();
            else reject(new Error(`control connection to port ${port} failed: ${data || '(no response)'}`));
        });
    });
}

/**
 * Session Client Detect Shutdown conformance unit (OPC UA Part 5, §12.6; Part 4, §5.13.5),
 * shared across all three RefServers: connects `client`, triggers a shutdown announcement via
 * `setServerState` (each RefServer exposes its own test-only, non-OPC-UA control channel — see
 * the per-server test files), and asserts the real client, over the wire, fires
 * `onServerShutdown` and can read again once reconnected.
 */
export async function verifyDetectShutdown(
    client: Client,
    setServerState: (state: 'Running' | 'Shutdown', estimatedReturnTime?: number) => Promise<void>,
): Promise<void> {
    const shutdownDetected = new Promise<void>((resolve) => {
        client.onServerShutdown = () => resolve();
    });

    try {
        await client.connect();

        const integerNodeId = NodeId.newString(2, 'Integer');
        const beforeShutdown = await client.read([integerNodeId]);
        expect(beforeShutdown[0]?.statusCode).toBe(StatusCode.Good);

        // Announce a shutdown that "returns" 500 ms from now.
        await setServerState('Shutdown', Date.now() + 500);

        await shutdownDetected;

        // Give the reconnect time to complete, then confirm the session is usable again
        // over the re-established channel.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const afterReconnect = await client.read([integerNodeId]);
        expect(afterReconnect[0]?.statusCode).toBe(StatusCode.Good);
    } finally {
        await setServerState('Running').catch(() => { /* best-effort cleanup */ });
        await client.disconnect();
    }
}