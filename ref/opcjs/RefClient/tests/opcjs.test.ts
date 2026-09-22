/**
 * Integration test – Discovery Client Configure Endpoint conformance unit
 * (OPC UA Part 4, §5.4.3): `Client.getEndpoints()` against RefServer
 * (ref/uaNet/RefServer).
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import './opcjsWebSocketPolyfill.js';

import { describe, expect, it } from 'vitest';
import { createClientFor, verifyGetEndpoints, verifyReadInteger } from './shared.js';
import { Client } from 'opcjs-client';

const endpointUrl = 'wss://localhost:62547/RefServer';
async function createClient(): Promise<Client> {
    return createClientFor(endpointUrl);
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
