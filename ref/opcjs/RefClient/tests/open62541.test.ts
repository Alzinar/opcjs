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
import { createClientFor, verifyGetEndpoints, verifyReadInteger, verifySubscribeChangingNumber } from './shared.js';

const endpointUrl = 'wss://127.0.0.1:62546/RefServer';

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
