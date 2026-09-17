/**
 * Integration test – read the `Integer` variable from RefServer.
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import { describe, expect, it } from 'vitest';
import { createClient, readInteger } from '../index.js';

describe('readInteger', () => {
    it('reads the Integer variable from RefServer', async () => {
        const client = await createClient();

        try {
            await client.connect();

            const value = await readInteger(client);

            expect(typeof value).toBe('number');
        } finally {
            await client.disconnect();
        }
    });
});
