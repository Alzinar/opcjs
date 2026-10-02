import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globalSetup: ['tests/globalSetup.ts'],
        // RefServer uses a self-signed OPC UA application certificate.
        // NODE_TLS_REJECT_UNAUTHORIZED=0 disables chain verification so the
        // test workers can open wss:// connections to it without needing the
        // cert in the system trust store.
        env: {
            NODE_TLS_REJECT_UNAUTHORIZED: '0',
        },
    },
});
