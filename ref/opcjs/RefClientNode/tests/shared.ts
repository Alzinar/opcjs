import { expect, vi } from 'vitest';
import { Client, ConfigurationClient, UserIdentity } from 'opcjs-client';
import { createDefaultCertificateStore, NodeId, StatusCode, Variant, uaInt64 } from 'opcjs-base';
import { certificateStoreOptions, type ServerState } from './platform.js';
import { verifyCommonAddressSpace } from './commonAddressSpace.js';

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
/** Sends one line of the RefServers' control protocol (see "Control channel" in ref/README.md). */
export type ControlCommand = (line: string) => Promise<string>;

/**
 * Smoke-tests the control commands every RefServer implements (SessionCount, AddNamespace,
 * CloseSessions) against a live session, so later tests can rely on them (DropConnections is
 * covered by {@link verifyDropConnections}).
 */
export async function verifyControlChannel(client: Client, control: ControlCommand): Promise<void> {
    const sessionCount = async (): Promise<number> => Number(await control('SessionCount'));
    const sessionsBefore = await sessionCount();
    try {
        await client.connect();
        expect(await sessionCount()).toBe(sessionsBefore + 1);

        const namespaceUri = `urn:opcjs:ref:control:${Date.now()}`;
        const namespaceIndex = Number(await control(`AddNamespace ${namespaceUri}`));
        const namespaceArray = await client.read([NodeId.newNumeric(0, 2255)]);
        expect(((namespaceArray[0]?.value as Variant).value as string[])[namespaceIndex]).toBe(namespaceUri);

        await control('CloseSessions');
        expect(await sessionCount()).toBe(0);
    } finally {
        await client.disconnect();
    }
}

/** Connects `client` and asserts the server exposes the common address space (see commonAddressSpace.ts). */
export async function verifyCommonAddressSpaceOf(client: Client, options: { hasMethods: boolean }): Promise<void> {
    try {
        await client.connect();
        await verifyCommonAddressSpace(client, options);
    } finally {
        await client.disconnect();
    }
}

/**
 * Asserts `SetMaxSessions` makes the server reject a session beyond the limit (a ServiceFault
 * with `BadTooManySessions`); the default limit is restored afterwards.
 */
export async function verifySessionLimit(createClient: () => Promise<Client>, control: ControlCommand): Promise<void> {
    const first = await createClient();
    const second = await createClient();

    try {
        await first.connect();
        await control(`SetMaxSessions ${await control('SessionCount')}`);
        await expect(second.connect()).rejects.toThrow();
    } finally {
        await control('SetMaxSessions 100');
        await first.disconnect();
        await second.disconnect().catch(() => { /* never connected */ });
    }
}

/**
 * Asserts `SetMaxSessionTimeout` shortens the revised session timeout: the opcjs client requests a
 * 60 s timeout, so an idle session only disappears quickly if the server revised it down.
 */
export async function verifySessionTimeout(client: Client, control: ControlCommand): Promise<void> {
    const sessionsBefore = Number(await control('SessionCount'));

    await control('SetMaxSessionTimeout 2000');
    try {
        await client.connect();
        expect(Number(await control('SessionCount'))).toBe(sessionsBefore + 1);

        await vi.waitFor(async () => {
            expect(Number(await control('SessionCount'))).toBe(sessionsBefore);
        }, { timeout: 25_000, interval: 500 });
    } finally {
        await control('SetMaxSessionTimeout 3600000');
        await client.disconnect().catch(() => { /* session already expired */ });
    }
}

/**
 * Asserts the `DropConnections` control command abruptly closes an open SecureChannel.
 * Uses a bare WebSocket (HEL/ACK + OpenSecureChannel handshake only) instead of an opcjs `Client`:
 * the client currently surfaces unhandled rejections when its channel is dropped underneath it.
 */
export async function verifyDropConnections(endpointUrl: string, control: ControlCommand): Promise<void> {
    const socket = new WebSocket(endpointUrl, 'opcua+uacp');
    socket.binaryType = 'arraybuffer';

    const messages: string[] = [];
    let notify: (() => void) | undefined;
    const nextMessageType = async (): Promise<string> => {
        while (messages.length === 0) {
            await new Promise<void>((resolve) => { notify = resolve; });
        }
        return messages.shift()!;
    };
    const opened = new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error(`could not open a WebSocket to ${endpointUrl}`));
    });
    socket.onmessage = (event) => {
        messages.push(new TextDecoder().decode(new Uint8Array(event.data as ArrayBuffer, 0, 3)));
        notify?.();
    };
    await opened;

    socket.send(buildHelloMessage(endpointUrl));
    expect(await nextMessageType()).toBe('ACK');
    socket.send(buildOpenSecureChannelMessage());
    expect(await nextMessageType()).toBe('OPN');

    const closed = new Promise<void>((resolve) => { socket.onclose = () => resolve(); });
    await control('DropConnections');
    await closed;
}

/** OPC UA Part 6, §7.1.2.3: the HEL message that opens a UA-TCP connection. */
function buildHelloMessage(endpointUrl: string): Uint8Array {
    const url = new TextEncoder().encode(endpointUrl);
    const message = new Uint8Array(32 + url.length);
    const view = new DataView(message.buffer);
    message.set(new TextEncoder().encode('HELF'), 0);
    view.setUint32(4, message.length, true);
    view.setUint32(8, 0, true); // ProtocolVersion
    view.setUint32(12, 65536, true); // ReceiveBufferSize
    view.setUint32(16, 65536, true); // SendBufferSize
    view.setUint32(20, 0, true); // MaxMessageSize (no limit)
    view.setUint32(24, 0, true); // MaxChunkCount (no limit)
    view.setInt32(28, url.length, true);
    message.set(url, 32);
    return message;
}

/** OPC UA Part 6, §6.7.4: an OpenSecureChannel(Issue) request using SecurityPolicy None. */
function buildOpenSecureChannelMessage(): Uint8Array {
    const policyUri = new TextEncoder().encode('http://opcfoundation.org/UA/SecurityPolicy#None');
    const message = new Uint8Array(256);
    const view = new DataView(message.buffer);
    let offset = 0;
    const u32 = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
    const i32 = (value: number) => { view.setInt32(offset, value, true); offset += 4; };
    const bytes = (value: number[]) => { message.set(value, offset); offset += value.length; };

    bytes([...new TextEncoder().encode('OPNF')]);
    u32(0); // MessageSize, patched below
    u32(0); // SecureChannelId
    i32(policyUri.length); // Asymmetric security header: SecurityPolicyUri
    message.set(policyUri, offset); offset += policyUri.length;
    i32(-1); // SenderCertificate (null)
    i32(-1); // ReceiverCertificateThumbprint (null)
    u32(1); // SequenceNumber
    u32(1); // RequestId
    bytes([0x01, 0x00, 446 & 0xff, 446 >> 8]); // OpenSecureChannelRequest_Encoding_DefaultBinary
    bytes([0x00, 0x00]); // RequestHeader.AuthenticationToken (null)
    offset += 8; // Timestamp
    u32(1); // RequestHandle
    u32(0); // ReturnDiagnostics
    i32(-1); // AuditEntryId (null)
    u32(0); // TimeoutHint
    bytes([0x00, 0x00, 0x00]); // AdditionalHeader (null ExtensionObject)
    u32(0); // ClientProtocolVersion
    u32(0); // RequestType: Issue
    u32(1); // SecurityMode: None
    i32(-1); // ClientNonce (null)
    u32(3_600_000); // RequestedLifetime
    view.setUint32(4, offset, true);
    return message.subarray(0, offset);
}
