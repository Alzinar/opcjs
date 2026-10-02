/**
 * Browser implementation of the platform-specific helpers used by the shared ref tests
 * in ref/opcjs/RefClientNode/tests. Swapped in for RefClientNode's `./platform.js` via
 * the alias in ../vitest.config.ts; must export the same API.
 */

import { commands } from 'vitest/browser';
import type { CreateDefaultCertificateStoreOptions } from 'opcjs-base';

export type ServerState = 'Running' | 'Shutdown';

declare module 'vitest/browser' {
    interface BrowserCommands {
        sendControlCommandTcp: (port: number, line: string) => Promise<string>;
        sendControlCommandHttp: (url: string, line: string) => Promise<string>;
        setServerStateTcp: (port: number, state: ServerState, estimatedReturnTime?: number) => Promise<void>;
        setServerStateHttp: (url: string, state: ServerState, estimatedReturnTime?: number) => Promise<void>;
    }
}

// The browser store lives in IndexedDB; a fresh Playwright context starts with an empty one.
export const certificateStoreOptions: CreateDefaultCertificateStoreOptions = {
    databaseName: 'RefClientWeb-pki',
};

// The browser can't open raw TCP sockets, so the control channels are driven from the
// Vitest (Node) side via browser commands defined in ../vitest.config.ts.
export async function sendControlCommandTcp(port: number, line: string): Promise<string> {
    return commands.sendControlCommandTcp(port, line);
}

export async function sendControlCommandHttp(url: string, line: string): Promise<string> {
    return commands.sendControlCommandHttp(url, line);
}

export async function setServerStateTcp(port: number, state: ServerState, estimatedReturnTime?: number): Promise<void> {
    await commands.setServerStateTcp(port, state, estimatedReturnTime);
}

export async function setServerStateHttp(url: string, state: ServerState, estimatedReturnTime?: number): Promise<void> {
    await commands.setServerStateHttp(url, state, estimatedReturnTime);
}

/**
 * Rewrites the `wss://` scheme `opcjs-client` always dials to `ws://` for ref/opcjs/RefServer,
 * which has no TLS listener. Vitest's browser mode runs each test file in its own iframe, so
 * this only affects the calling test file.
 */
export function downgradeWssToWs(): void {
    const NativeWebSocket = globalThis.WebSocket;

    class TestWebSocket extends NativeWebSocket {
        constructor(address: string | URL, protocols?: string | string[]) {
            super(address.toString().replace(/^wss:\/\//, 'ws://'), protocols);
        }
    }

    globalThis.WebSocket = TestWebSocket;
}
