/**
 * Integration test – Discovery Client Configure Endpoint conformance unit
 * (OPC UA Part 4, §5.4.3) and read-Integer interop check against the uaNet
 * RefServer (ref/uaNet/RefServer).
 *
 * The server is started automatically by the global setup (globalSetup.ts)
 * before Vitest executes any test in this suite.
 */

import { describe, it } from 'vitest';
import { Client } from 'opcjs-client';
import { createClientFor, verifyCommonAddressSpaceOf, verifyControlChannel, verifyDetectShutdown, verifyDropConnections, verifyGetEndpoints, verifyReadInteger, verifyReadWriteInt64Array, verifySessionLimit, verifySessionTimeout, verifySubscribeChangingNumber } from './shared.js';
import { sendControlCommandTcp, setServerStateTcp } from './platform.js';

const endpointUrl = 'wss://localhost:62544/RefServer/';
// Test-only, localhost-only control listener (see ControlServer.cs in ref/uaNet/RefServer).
const controlPort = 62549;

async function control(line: string): Promise<string> {
  return sendControlCommandTcp(controlPort, line);
}

async function createClient(): Promise<Client> {
  return createClientFor(endpointUrl);
}

// Runs first: DropConnections also severs connections lingering from earlier tests of this file,
// which would surface as unhandled rejections inside their (already finished) clients.
describe('drop connections', () => {
  it('drops open connections of the uaNet RefServer', async () => {
    await verifyDropConnections(endpointUrl, control);
  });
});

describe('getEndpoints', () => {
  it('discovers the endpoints exposed by the uaNet RefServer', async () => {
    const client = await createClient();

    await verifyGetEndpoints(client, endpointUrl);
  });

  it('reads the Integer variable from the uaNet RefServer', async () => {
    const client = await createClient();

    await verifyReadInteger(client);
  });
});

describe('write', () => {
  it('writes and reads back an Int64 array on the uaNet RefServer', async () => {
    const client = await createClient();

    await verifyReadWriteInt64Array(client);
  });
});

describe('subscribe', () => {
  it('receives changing values for the Integer variable from the uaNet RefServer', async () => {
    const client = await createClient();

    await verifySubscribeChangingNumber(client);
  }, 15_000);
});

describe('detect shutdown', () => {
  it('detects a server shutdown announcement and reconnects afterwards', async () => {
    const client = await createClientFor(endpointUrl, (configuration) => {
      // Poll far faster than the 25 s production default so the test doesn't have to
      // wait that long for the keep-alive read to observe the shutdown. uaNet doesn't
      // report a real EstimatedReturnTime (that field is nonstandard — opcjs-only, see
      // ServerStatusDataType, OPC UA Part 5 §12.10), so the reconnect falls back to
      // shutdownReconnectDelayMs; shrink that too.
      configuration.keepAliveIntervalMs = 200;
      configuration.minReconnectDelayMs = 100;
      configuration.shutdownReconnectDelayMs = 200;
    });

    await verifyDetectShutdown(client, (state, estimatedReturnTime) => setServerStateTcp(controlPort, state, estimatedReturnTime));
  }, 20_000);
});

describe('common address space', () => {
  it('exposes the common address space on the uaNet RefServer', async () => {
    const client = await createClient();

    await verifyCommonAddressSpaceOf(client, { hasMethods: true });
  }, 30_000);
});

describe('control channel', () => {
  it('tracks sessions, adds namespaces and closes sessions of the uaNet RefServer', async () => {
    const client = await createClient();

    await verifyControlChannel(client, control);
  }, 30_000);

  it('rejects sessions above the limit set via SetMaxSessions on the uaNet RefServer', async () => {
    await verifySessionLimit(createClient, control);
  }, 30_000);

  it('expires idle sessions after the timeout set via SetMaxSessionTimeout on the uaNet RefServer', async () => {
    const client = await createClient();

    await verifySessionTimeout(client, control);
  }, 40_000);
});
