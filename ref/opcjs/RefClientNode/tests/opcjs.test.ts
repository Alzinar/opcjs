/**
 * Integration test – Discovery Client Configure Endpoint conformance unit
 * (OPC UA Part 4, §5.4.3): `Client.getEndpoints()` against RefServer
 * (ref/uaNet/RefServer).
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import { describe, it } from 'vitest';
import { createClientFor, verifyDetectShutdown, verifyGetEndpoints, verifyReadInteger, verifySubscribeChangingNumber } from './shared.js';
import { downgradeWssToWs, setServerStateHttp, type ServerState } from './platform.js';
import { Client } from 'opcjs-client';

// opcjs-server only exposes an unencrypted ws:// listener.
downgradeWssToWs();

const endpointUrl = 'wss://localhost:62547/RefServer';
// Test-only, localhost-only HTTP control endpoint (see startControlServer in
// ref/opcjs/RefServer/index.ts), used only by the "detect shutdown" suite below.
const controlUrl = 'http://127.0.0.1:62548/server-state';

async function createClient(): Promise<Client> {
    return createClientFor(endpointUrl);
}

async function setServerState(state: ServerState, estimatedReturnTime?: number): Promise<void> {
    return setServerStateHttp(controlUrl, state, estimatedReturnTime);
}

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
