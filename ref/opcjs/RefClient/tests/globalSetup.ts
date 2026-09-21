/**
 * Vitest global setup for RefClient integration tests.
 *
 * Starts the RefServer (ref/uaNet/RefServer) via `dotnet run` before any test
 * runs and shuts it down once all tests have completed. No test is allowed to
 * proceed until the server prints "Server started." to its standard output.
 *
 * Set the environment variable OPCUA_EXTERNAL_SERVER=1 to skip the automatic
 * server lifecycle management. This is useful when you want to start and
 * debug the server yourself before running the tests, e.g.:
 *
 *   OPCUA_EXTERNAL_SERVER=1 npm test
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serverProcess: ChildProcess | null = null;
let open62541ServerProcess: ChildProcess | null = null;
let opcjsServerProcess: ChildProcess | null = null;

const serverLogging = process.env.OPCUA_SERVER_LOGGING === '1';

function now(): string {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const p3 = (n: number) => String(n).padStart(3, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
        `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
}

function log(level: string, component: string, msg: string): void {
    if (serverLogging) {
        process.stdout.write(`${now()} [${level}] [${component}] ${msg}\n`);
    }
}

function prefixLines(text: string, level: string, component: string): string {
    const ts = now();
    return text
        .split('\n')
        .map((line, i, arr) =>
            // Skip the empty string produced by a trailing newline.
            i === arr.length - 1 && line === '' ? '' : `${ts} [${level}] [${component}] ${line}`
        )
        .join('\n');
}

function startServer(
    name: string,
    command: string,
    args: string[],
    cwd: string,
    readyMarker: string,
): Promise<ChildProcess> {
    return new Promise<ChildProcess>((resolve, reject) => {
        let started = false;

        const proc = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const startupTimeout = setTimeout(() => {
            if (!started) {
                reject(new Error(`Timed out waiting 60 s for "${readyMarker}" from ${name}`));
            }
        }, 60_000);

        proc.stdout!.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            if (serverLogging) {
                process.stderr.write(prefixLines(text, 'DEBUG', name));
            }
            if (!started && text.includes(readyMarker)) {
                started = true;
                clearTimeout(startupTimeout);
                log('DEBUG', 'globalSetup', `${name} is ready.`);
                resolve(proc);
            }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
            if (serverLogging) {
                process.stderr.write(prefixLines(chunk.toString(), 'WARN', name));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(startupTimeout);
            if (!started) {
                reject(new Error(`Failed to start ${name}: ${err.message}`));
            }
        });

        proc.on('exit', (code) => {
            clearTimeout(startupTimeout);
            // Only reject if the process exits before startup completed.
            if (!started) {
                reject(new Error(`${name} exited unexpectedly with code ${code}`));
            }
        });
    });
}

async function killLeftovers(pattern: string): Promise<void> {
    await new Promise<void>((resolve) => {
        const killer = spawn('pkill', ['-9', '-f', pattern], { stdio: 'ignore' });
        killer.on('exit', () => resolve());
        killer.on('error', () => resolve()); // pkill not available on all platforms
    });
}

export async function setup(): Promise<void> {
    if (process.env.OPCUA_EXTERNAL_SERVER === '1') {
        console.log('[globalSetup] OPCUA_EXTERNAL_SERVER=1 – skipping server start. Tests requiring a server will fail if none is running.');
        return;
    }

    const serverDir = path.resolve(__dirname, '../../../uaNet/RefServer');
    const open62541ServerDir = path.resolve(__dirname, '../../../open62541/RefServer');
    const opcjsServerDir = path.resolve(__dirname, '../../../opcjs/RefServer');

    log('DEBUG', 'globalSetup', 'Killing any leftover server processes...');
    // Kill any leftover server processes from a previous (interrupted) run.
    // `dotnet run` produces an apphost binary at bin/<Config>/<tfm>/RefServer, while a
    // published/copied build is invoked as `dotnet RefServer.dll` — match both.
    await killLeftovers('uaNet/RefServer/bin/.*/RefServer$|RefServer\\.dll');
    await killLeftovers('open62541/RefServer/build/RefServer$');
    await killLeftovers('opcjs/RefServer/dist/index\\.js');
    // Give the OS a moment to release the ports.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    log('DEBUG', 'globalSetup', 'Starting RefServer...');
    serverProcess = await startServer('RefServer', 'dotnet', ['run'], serverDir, 'Server started.');

    log('DEBUG', 'globalSetup', 'Starting open62541 RefServer...');
    open62541ServerProcess = await startServer(
        'open62541RefServer', path.join(open62541ServerDir, 'build', 'RefServer'), [], open62541ServerDir, 'Server started.',
    );

    log('DEBUG', 'globalSetup', 'Starting opcjs RefServer...');
    opcjsServerProcess = await startServer(
        'opcjsRefServer', 'node', [path.join(opcjsServerDir, 'dist', 'index.js')], opcjsServerDir, 'Server started.',
    );
}

export async function teardown(): Promise<void> {
    if (process.env.OPCUA_EXTERNAL_SERVER === '1') {
        return;
    }

    if (serverProcess) {
        log('DEBUG', 'globalSetup', 'Stopping RefServer...');
        const proc = serverProcess;
        serverProcess = null;
        await new Promise<void>((resolve) => {
            proc.on('exit', () => resolve());
            proc.kill('SIGKILL');
        });
        // `dotnet run` spawns the apphost as a separate child process, which is not
        // terminated by killing the `dotnet run` process itself — clean it up too.
        await killLeftovers('uaNet/RefServer/bin/.*/RefServer$');
        log('DEBUG', 'globalSetup', 'RefServer stopped.');
    }

    if (open62541ServerProcess) {
        log('DEBUG', 'globalSetup', 'Stopping open62541 RefServer...');
        const proc = open62541ServerProcess;
        open62541ServerProcess = null;
        await new Promise<void>((resolve) => {
            proc.on('exit', () => resolve());
            proc.kill('SIGKILL');
        });
        log('DEBUG', 'globalSetup', 'open62541 RefServer stopped.');
    }

    if (opcjsServerProcess) {
        log('DEBUG', 'globalSetup', 'Stopping opcjs RefServer...');
        const proc = opcjsServerProcess;
        opcjsServerProcess = null;
        await new Promise<void>((resolve) => {
            proc.on('exit', () => resolve());
            proc.kill('SIGKILL');
        });
        log('DEBUG', 'globalSetup', 'opcjs RefServer stopped.');
    }
}
