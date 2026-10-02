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
 * Sends one line of the RefServers' shared control protocol (see "Control channel" in
 * ref/README.md) over a raw-TCP, line-based test-only control listener: connects to `port`,
 * sends `line`, and expects a reply starting with `OK`. Resolves with whatever follows `OK`
 * (the command's payload, possibly empty). Used by servers whose control channel is a plain
 * TCP listener (ref/uaNet/RefServer's ControlServer.cs, ref/open62541/RefServer's
 * controlServerThread) rather than HTTP.
 */
export async function sendControlCommandTcp(port: number, line: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
            socket.write(`${line}\n`);
        });
        let data = '';
        socket.on('data', (chunk) => { data += chunk.toString(); });
        socket.on('error', reject);
        socket.on('close', () => {
            const reply = data.trim();
            if (reply === 'OK' || reply.startsWith('OK ')) resolve(reply.slice(2).trim());
            else reject(new Error(`control command "${line}" on port ${port} failed: ${reply || '(no response)'}`));
        });
    });
}

/** Same protocol as {@link sendControlCommandTcp}, sent to ref/opcjs/RefServer's HTTP control endpoint (`POST /control`). */
export async function sendControlCommandHttp(url: string, line: string): Promise<string> {
    const response = await fetch(url, { method: 'POST', body: line });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`control command "${line}" failed: ${response.status} ${text}`);
    }
    return text.trim();
}

/** Flips a RefServer's `Server/ServerStatus/State` via the raw-TCP control channel (`Shutdown <epochMs>` or `Running`). */
export async function setServerStateTcp(
    port: number,
    state: ServerState,
    estimatedReturnTime?: number,
): Promise<void> {
    await sendControlCommandTcp(port, state === 'Shutdown' ? `Shutdown ${estimatedReturnTime ?? 0}` : 'Running');
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
