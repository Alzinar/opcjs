/**
 * Integration test – Discovery Client Configure Endpoint conformance unit
 * (OPC UA Part 4, §5.4.3): `Client.getEndpoints()` against RefServer
 * (ref/uaNet/RefServer).
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import { describe, expect, it } from 'vitest';
import { Client } from 'opcjs-client';
import { createClientFor, setServerStateTcp, verifyDetectShutdown, verifyGetEndpoints, verifyReadInteger, verifySubscribeChangingNumber } from './shared.js';

const endpointUrl = 'wss://127.0.0.1:62546/RefServer';
// Test-only, localhost-only control listener (see controlServerThread in
// ref/open62541/RefServer/src/main.c).
const controlPort = 62551;

async function createClient(): Promise<Client> {
  return createClientFor(endpointUrl);
}


describe('getEndpoints', () => {

    it('discovers the endpoints exposed by the open62541 RefServer', async () => {
        const client = await createClient();

        await verifyGetEndpoints(client, endpointUrl);
    });

    it('reads the Integer variable from the open62541 RefServer', async () => {
        const client = await createClient();

        await verifyReadInteger(client);
    });
});

describe('subscribe', () => {

    it('receives changing values for the Integer variable from the open62541 RefServer', async () => {
        const client = await createClient();

        await verifySubscribeChangingNumber(client);
    }, 15_000);
});

describe('detect shutdown', () => {

    it('detects a server shutdown announcement and reconnects afterwards', async () => {
        const client = await createClientFor(endpointUrl, (configuration) => {
            // Poll far faster than the 25 s production default so the test doesn't have to
            // wait that long for the keep-alive read to observe the shutdown. open62541
            // doesn't report a real EstimatedReturnTime (that field is nonstandard —
            // opcjs-only, see ServerStatusDataType, OPC UA Part 5 §12.10), so the reconnect
            // falls back to shutdownReconnectDelayMs; shrink that too.
            configuration.keepAliveIntervalMs = 200;
            configuration.minReconnectDelayMs = 100;
            configuration.shutdownReconnectDelayMs = 200;
        });

        await verifyDetectShutdown(client, (state, estimatedReturnTime) => setServerStateTcp(controlPort, state, estimatedReturnTime));
    }, 20_000);
});
