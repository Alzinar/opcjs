/**
 * Integration test – read the `Integer` variable from the open62541 reference
 * server (ref/open62541/RefServer).
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import { describe, expect, it } from 'vitest';
import { createOpen62541Client, readInteger, open62541IntegerNodeId } from '../index.js';

describe('readIntegerOpen62541', () => {
    it('reads the Integer variable from the open62541 RefServer', async () => {
        const client = await createOpen62541Client();

        try {
            await client.connect();

            const value = await readInteger(client, open62541IntegerNodeId);

            expect(typeof value).toBe('number');
        } finally {
            await client.disconnect();
        }
    });
});
