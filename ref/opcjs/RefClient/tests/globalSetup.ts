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

export async function setup(): Promise<void> {
    if (process.env.OPCUA_EXTERNAL_SERVER === '1') {
        console.log('[globalSetup] OPCUA_EXTERNAL_SERVER=1 – skipping server start. Tests requiring a server will fail if none is running.');
        return;
    }

    const serverDir = path.resolve(__dirname, '../../../uaNet/RefServer');

    log('DEBUG', 'globalSetup', 'Killing any leftover RefServer process...');
    // Kill any leftover server process from a previous (interrupted) run.
    // `dotnet run` produces an apphost binary at bin/<Config>/<tfm>/RefServer, while a
    // published/copied build is invoked as `dotnet RefServer.dll` — match both.
    await new Promise<void>((resolve) => {
        const killer = spawn('pkill', ['-9', '-f', 'uaNet/RefServer/bin/.*/RefServer$|RefServer\\.dll'], { stdio: 'ignore' });
        killer.on('exit', () => resolve());
        killer.on('error', () => resolve()); // pkill not available on all platforms
    });
    // Give the OS a moment to release the port.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    log('DEBUG', 'globalSetup', 'Starting RefServer...');
    await new Promise<void>((resolve, reject) => {
        let started = false;

        serverProcess = spawn('dotnet', ['run'], {
            cwd: serverDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const startupTimeout = setTimeout(() => {
            if (!started) {
                reject(new Error('Timed out waiting 60 s for "Server started." from RefServer'));
            }
        }, 60_000);

        serverProcess.stdout!.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            if (serverLogging) {
                process.stderr.write(prefixLines(text, 'DEBUG', 'RefServer'));
            }
            if (!started && text.includes('Server started.')) {
                started = true;
                clearTimeout(startupTimeout);
                log('DEBUG', 'globalSetup', 'RefServer is ready.');
                resolve();
            }
        });

        serverProcess.stderr!.on('data', (chunk: Buffer) => {
            if (serverLogging) {
                process.stderr.write(prefixLines(chunk.toString(), 'WARN', 'RefServer'));
            }
        });

        serverProcess.on('error', (err) => {
            clearTimeout(startupTimeout);
            if (!started) {
                reject(new Error(`Failed to start RefServer: ${err.message}`));
            }
        });

        serverProcess.on('exit', (code) => {
            clearTimeout(startupTimeout);
            // Only reject if the process exits before startup completed.
            if (!started) {
                reject(new Error(`RefServer exited unexpectedly with code ${code}`));
            }
        });
    });
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
        await new Promise<void>((resolve) => {
            const killer = spawn('pkill', ['-9', '-f', 'uaNet/RefServer/bin/.*/RefServer$'], { stdio: 'ignore' });
            killer.on('exit', () => resolve());
            killer.on('error', () => resolve());
        });
        log('DEBUG', 'globalSetup', 'RefServer stopped.');
    }
}
