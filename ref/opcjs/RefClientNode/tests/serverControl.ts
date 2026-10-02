/**
 * Node.js helpers that drive the RefServers' test-only, non-OPC-UA control channels.
 *
 * Used directly by the Node tests (via platform.ts) and, as Vitest browser commands,
 * by ref/opcjs/RefClientWeb (see its vitest.config.ts) — the browser can't open raw TCP
 * sockets and the HTTP control endpoint doesn't send CORS headers.
 *
 * Only depends on Node built-ins so RefClientWeb can import it without RefClientNode's
 * node_modules being installed.
 */

import net from 'node:net';

export type ServerState = 'Running' | 'Shutdown';

/**
 * Flips a RefServer's `Server/ServerStatus/State` via a raw-TCP, line-based test-only control
 * listener: connects to `port`, sends a single line (`Shutdown <epochMs>` or `Running`), and
 * expects a reply starting with `OK`. Used by servers whose control channel is a plain TCP
 * listener (ref/uaNet/RefServer's ControlServer.cs, ref/open62541/RefServer's controlServerThread)
 * rather than HTTP.
 */
export async function setServerStateTcp(
    port: number,
    state: ServerState,
    estimatedReturnTime?: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
            socket.write(state === 'Shutdown' ? `Shutdown ${estimatedReturnTime ?? 0}\n` : 'Running\n');
        });
        let data = '';
        socket.on('data', (chunk) => { data += chunk.toString(); });
        socket.on('error', reject);
        socket.on('close', () => {
            if (data.trim().startsWith('OK')) resolve();
            else reject(new Error(`control connection to port ${port} failed: ${data || '(no response)'}`));
        });
    });
}

/** Flips ref/opcjs/RefServer's reported `Server/ServerStatus/State` via its test-only HTTP control endpoint. */
export async function setServerStateHttp(
    url: string,
    state: ServerState,
    estimatedReturnTime?: number,
): Promise<void> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, estimatedReturnTime }),
    });
    if (!response.ok) {
        throw new Error(`Failed to set server state: ${response.status} ${await response.text()}`);
    }
}
