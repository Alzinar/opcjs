/**
 * Integration test – read the `Integer` variable from the opcjs RefServer
 * (ref/opcjs/RefServer), i.e. opcjs-client talking to opcjs-server.
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite. Importing the polyfill
 * below (before opcjs-client is used) is required because opcjs-server only
 * exposes an unencrypted ws:// listener — see opcjsWebSocketPolyfill.ts.
 */

import './opcjsWebSocketPolyfill.js';

import { describe, expect, it } from 'vitest';
import { createOpcjsClient, opcjsIntegerNodeId, readInteger } from '../index.js';

describe('readIntegerOpcjs', () => {
    it('reads the Integer variable from the opcjs RefServer', async () => {
        const client = await createOpcjsClient();

        try {
            await client.connect();

            const value = await readInteger(client, opcjsIntegerNodeId);

            expect(typeof value).toBe('number');
        } finally {
            await client.disconnect();
        }
    });
});
