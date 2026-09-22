/**
 * Test-only WebSocket polyfill for the opcjs RefServer interop test.
 *
 * `opcjs-client`'s `WebSocketFascade` always dials `wss://` (see
 * packages/base/src/transports/ws/webSocketFascade.ts), but `opcjs-server`
 * (ref/opcjs/RefServer) only exposes an unencrypted `ws://` listener — see
 * packages/server/src/transport/webSocketListener.ts. Importing this module
 * installs a global `WebSocket` that wraps the Node `ws` package and rewrites
 * `wss://` to `ws://` before opening the underlying socket, mirroring
 * packages/e2e/tests/setup/webSocketPolyfill.ts.
 *
 * Only import this from tests that talk to ref/opcjs/RefServer: Vitest runs
 * each test file in its own isolated module/global context by default, so
 * this does not affect the other RefClient tests (uaNet.test.ts,
 * open62541.test.ts), which need the real, TLS-backed global
 * `WebSocket`.
 */

import { WebSocket as WsWebSocket } from 'ws';

class TestWebSocket extends WsWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
        const url = typeof address === 'string' ? address : address.toString();
        const wsUrl = url.replace(/^wss:\/\//, 'ws://');
        super(wsUrl, protocols);
    }
}

// Expose on globalThis so `new WebSocket(...)` inside opcjs-base resolves to us.
(globalThis as unknown as { WebSocket: typeof WsWebSocket }).WebSocket =
    TestWebSocket as unknown as typeof WsWebSocket;
