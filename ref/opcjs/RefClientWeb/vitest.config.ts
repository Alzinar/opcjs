import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setServerStateHttp, setServerStateTcp, type ServerState } from '../RefClientNode/tests/serverControl.js';
import { loadTlsClientCertificate } from './tlsClientCertificate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The test specs are shared with RefClientNode; only the platform module differs.
const sharedTestsDir = path.resolve(here, '../RefClientNode/tests');
// Shared, gitignored location for every ref/ implementation's generated certificates.
const tlsPkiBaseDir = path.resolve(here, '../../..', 'tmp', 'ref', 'opcjs', 'RefClientWeb', 'tls-pki');

const tlsClientCertificate = await loadTlsClientCertificate(tlsPkiBaseDir);

// The browser can't open raw TCP sockets and the HTTP control endpoint sends no CORS
// headers, so tests/platform.ts drives the RefServers' control channels through these.
const setServerStateTcpCommand: BrowserCommand<[number, ServerState, number?]> =
    (_ctx, port, state, estimatedReturnTime) => setServerStateTcp(port, state, estimatedReturnTime);
const setServerStateHttpCommand: BrowserCommand<[string, ServerState, number?]> =
    (_ctx, url, state, estimatedReturnTime) => setServerStateHttp(url, state, estimatedReturnTime);

export default defineConfig({
    resolve: {
        alias: [
            { find: /^\.\/platform\.js$/, replacement: path.resolve(here, 'tests/platform.ts') },
        ],
        // The shared specs live outside this project; resolve their bare imports from here.
        dedupe: ['vitest', 'opcjs-base', 'opcjs-client'],
    },
    test: {
        dir: sharedTestsDir,
        include: ['**/*.test.ts'],
        globalSetup: [path.join(sharedTestsDir, 'globalSetup.ts')],
        browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
                // The RefServers use self-signed TLS certificates for their wss:// endpoints
                // (the provider already sets ignoreHTTPSErrors for the page context).
                launchOptions: { args: ['--ignore-certificate-errors'] },
                contextOptions: {
                    clientCertificates: [{ origin: 'https://localhost:62544', ...tlsClientCertificate }],
                },
            }),
            instances: [{ browser: 'chromium' }],
            commands: {
                setServerStateTcp: setServerStateTcpCommand,
                setServerStateHttp: setServerStateHttpCommand,
            },
        },
    },
});
