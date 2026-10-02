/**
 * Integration test – Discovery Client Configure Endpoint conformance unit
 * (OPC UA Part 4, §5.4.3): `Client.getEndpoints()` against RefServer
 * (ref/uaNet/RefServer).
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import { describe, it } from 'vitest';
import { createClientFor, verifyCommonAddressSpaceOf, verifyControlChannel, verifyDetectShutdown, verifyDropConnections, verifyGetEndpoints, verifyReadInteger, verifyReadWriteInt64Array, verifySessionLimit, verifySessionTimeout, verifySubscribeChangingNumber } from './shared.js';
import { downgradeWssToWs, sendControlCommandHttp, setServerStateHttp, type ServerState } from './platform.js';
import { Client } from 'opcjs-client';

// opcjs-server only exposes an unencrypted ws:// listener.
downgradeWssToWs();

const endpointUrl = 'wss://localhost:62547/RefServer';
// Test-only, localhost-only HTTP control endpoint (see startControlServer in
// ref/opcjs/RefServer/index.ts), used only by the "detect shutdown" suite below.
const controlUrl = 'http://127.0.0.1:62548/server-state';
const controlCommandUrl = 'http://127.0.0.1:62548/control';

async function createClient(): Promise<Client> {
    return createClientFor(endpointUrl);
}

async function control(line: string): Promise<string> {
    return sendControlCommandHttp(controlCommandUrl, line);
}

async function setServerState(state: ServerState, estimatedReturnTime?: number): Promise<void> {
    return setServerStateHttp(controlUrl, state, estimatedReturnTime);
}

// Runs first: DropConnections also severs connections lingering from earlier tests of this file,
// which would surface as unhandled rejections inside their (already finished) clients.
describe('drop connections', () => {
    it('drops open connections of the opcjs RefServer', async () => {
        await verifyDropConnections(endpointUrl, control);
    });
});

describe('getEndpoints', () => {
    it('discovers the endpoints exposed by the opcjs RefServer', async () => {
        const client = await createClient();

        await verifyGetEndpoints(client, endpointUrl);
    });

    it('reads the Integer variable from the opcjs RefServer', async () => {
        const client = await createClient();

        await verifyReadInteger(client);
    });
});

describe('write', () => {
    it('writes and reads back an Int64 array on the opcjs RefServer', async () => {
        const client = await createClient();

        await verifyReadWriteInt64Array(client);
    });
});

describe('subscribe', () => {
    it('receives changing values for the Integer variable from the opcjs RefServer', async () => {
        const client = await createClient();

        await verifySubscribeChangingNumber(client);
    }, 15_000);
});

describe('detect shutdown', () => {
    it('detects a server shutdown announcement and reconnects afterwards', async () => {
        const client = await createClientFor(endpointUrl, (configuration) => {
            // Poll far faster than the 25 s production default so the test doesn't
            // have to wait that long for the keep-alive read to observe the shutdown.
            configuration.keepAliveIntervalMs = 200;
            configuration.minReconnectDelayMs = 100;
        });

        await verifyDetectShutdown(client, setServerState);
    }, 20_000);
});

describe('common address space', () => {
    it('exposes the common address space on the opcjs RefServer', async () => {
        const client = await createClient();

        // opcjs-server has no Call service yet, so the Methods object is absent.
        await verifyCommonAddressSpaceOf(client, { hasMethods: false });
    }, 30_000);
});

describe('control channel', () => {
    it('tracks sessions, adds namespaces and closes sessions of the opcjs RefServer', async () => {
        const client = await createClient();

        await verifyControlChannel(client, control);
    }, 30_000);

    it('rejects sessions above the limit set via SetMaxSessions on the opcjs RefServer', async () => {
        await verifySessionLimit(createClient, control);
    }, 30_000);

    it('expires idle sessions after the timeout set via SetMaxSessionTimeout on the opcjs RefServer', async () => {
        const client = await createClient();

        await verifySessionTimeout(client, control);
    }, 40_000);
});
