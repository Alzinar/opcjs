import { expect } from 'vitest';
import { Client, ConfigurationClient, UserIdentity } from 'opcjs-client';
import { createDefaultCertificateStore, NodeId, StatusCode, Variant, uaInt64 } from 'opcjs-base';
import { certificateStoreOptions, type ServerState } from './platform.js';

export async function createClientFor(endpoint: string, configure?: (configuration: ConfigurationClient) => void): Promise<Client> {
    const configuration = ConfigurationClient.getSimple('RefClient', 'opcjs');
    configure?.(configuration);
    // Reference servers use self-signed certificates; trust them on first use rather
    // than requiring them to be pre-installed in the trust list.
    const certificateStore = await createDefaultCertificateStore({ ...certificateStoreOptions, unknownCertificatePolicy: 'trust' });

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
 * Connects `client`, writes an Int64 array to the writable `Int64Array` variable and reads it
 * back, asserting the values (including ones beyond Number.MAX_SAFE_INTEGER) round-trip exactly.
 */
export async function verifyReadWriteInt64Array(client: Client): Promise<void> {
    const values = [0n, -1n, 9007199254740993n, 9223372036854775807n, -9223372036854775808n];

    try {
        await client.connect();

        const nodeId = NodeId.newString(2, 'Int64Array');
        const writeStatus = await client.write(nodeId, values.map(uaInt64));
        expect(writeStatus).toBe(StatusCode.Good);

        const results = await client.read([nodeId]);
        expect(results[0]?.statusCode).toBe(StatusCode.Good);
        expect(((results[0]?.value as Variant).value as bigint[])).toEqual(values);
    } finally {
        await client.disconnect();
    }
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
 * Session Client Detect Shutdown conformance unit (OPC UA Part 5, §12.6; Part 4, §5.13.5),
 * shared across all three RefServers: connects `client`, triggers a shutdown announcement via
 * `setServerState` (each RefServer exposes its own test-only, non-OPC-UA control channel — see
 * the per-server test files), and asserts the real client, over the wire, fires
 * `onServerShutdown` and can read again once reconnected.
 */
export async function verifyDetectShutdown(
    client: Client,
    setServerState: (state: ServerState, estimatedReturnTime?: number) => Promise<void>,
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