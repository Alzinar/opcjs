/**
 * Node.js implementation of the platform-specific helpers used by the shared ref tests.
 *
 * The *.test.ts files and shared.ts in this folder are also executed in a headless
 * browser by ref/opcjs/RefClientWeb, whose vitest.config.ts aliases `./platform.js`
 * to ref/opcjs/RefClientWeb/tests/platform.ts. Both modules must export the same API.
 */

import path from 'node:path';
import { WebSocket as WsWebSocket } from 'ws';
import type { CreateDefaultCertificateStoreOptions } from 'opcjs-base';

export { sendControlCommandHttp, sendControlCommandTcp, setServerStateHttp, setServerStateTcp, type ServerState } from './serverControl.js';

// Shared, easily-gitignored location for every ref/ implementation's generated/received
// certificates (see /tmp/ in .gitignore). __dirname is tests/, one level deeper than
// the repo-root-relative path expects, hence the extra '..'.
export const certificateStoreOptions: CreateDefaultCertificateStoreOptions = {
    pkiBaseDir: path.resolve(__dirname, '../../../..', 'tmp', 'ref', 'opcjs', 'RefClientNode', 'pki'),
};

/**
 * `opcjs-client`'s `WebSocketFascade` always dials `wss://` (see
 * packages/base/src/transports/ws/webSocketFascade.ts), but `opcjs-server`
 * (ref/opcjs/RefServer) only exposes an unencrypted `ws://` listener — see
 * packages/server/src/transport/webSocketListener.ts. Installs a global
 * `WebSocket` that wraps the Node `ws` package and rewrites `wss://` to `ws://`.
 *
 * Only call this from tests that talk to ref/opcjs/RefServer: Vitest runs each
 * test file in its own isolated context, so this does not affect the other
 * tests, which need the real, TLS-backed global `WebSocket`.
 */
export function downgradeWssToWs(): void {
    class TestWebSocket extends WsWebSocket {
        constructor(address: string | URL, protocols?: string | string[]) {
            const url = typeof address === 'string' ? address : address.toString();
            super(url.replace(/^wss:\/\//, 'ws://'), protocols);
        }
    }

    (globalThis as unknown as { WebSocket: typeof WsWebSocket }).WebSocket = TestWebSocket;
}
