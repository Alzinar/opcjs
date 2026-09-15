/**
 * Unit tests for the Discovery Client Configure Endpoint conformance unit
 * (OPC UA Part 4, §5.4.3): `Client.getEndpoints()` and `Client.connect(endpoint)`.
 */

import { describe, expect, it, vi } from 'vitest'

import { EndpointDescription, GetEndpointsResponse, StatusCode } from 'opcjs-base'

import { Client } from '../../src/client.js'
import { ConfigurationClient } from '../../src/configuration/configurationClient.js'
import { UserIdentity } from '../../src/userIdentity.js'

function makeClient(): Client {
  const config = ConfigurationClient.getSimple('discovery-test', 'test')
  return new Client('opc.wss://localhost:4840', config, UserIdentity.newAnonymous())
}

describe('Client.getEndpoints', () => {
  it('opens a transient channel, queries GetEndpoints, and tears the channel down', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const ep = new EndpointDescription()
    ep.endpointUrl = 'opc.wss://localhost:4840'

    const response = new GetEndpointsResponse()
    response.responseHeader = { serviceResult: StatusCode.Good } as GetEndpointsResponse['responseHeader']
    response.endpoints = [ep]

    const scClose = vi.fn()
    const wsClose = vi.fn()
    const sc = { issueServiceRequest: vi.fn().mockResolvedValue(response), close: scClose }
    const ws = { close: wsClose }
    c.openTransportAndChannel = vi.fn().mockResolvedValue({ ws, sc })

    const result = await client.getEndpoints()

    expect(result).toEqual([ep])
    expect(scClose).toHaveBeenCalledOnce()
    expect(wsClose).toHaveBeenCalledOnce()
  })

  it('closes the transient channel even when GetEndpoints fails', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const scClose = vi.fn()
    const wsClose = vi.fn()
    const sc = { issueServiceRequest: vi.fn().mockRejectedValue(new Error('network error')), close: scClose }
    const ws = { close: wsClose }
    c.openTransportAndChannel = vi.fn().mockResolvedValue({ ws, sc })

    await expect(client.getEndpoints()).rejects.toThrow('network error')

    expect(scClose).toHaveBeenCalledOnce()
    expect(wsClose).toHaveBeenCalledOnce()
  })
})

describe('Client.connect(endpoint)', () => {
  it('uses the endpointUrl from a pre-selected EndpointDescription, bypassing GetEndpoints', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const usedUrls: string[] = []
    c.openTransportAndChannel = vi.fn().mockImplementation(async () => {
      usedUrls.push(c.endpointUrl)
      throw new Error('stop before session creation')
    })

    const ep = new EndpointDescription()
    ep.endpointUrl = 'opc.wss://other-host:4840'

    await expect(client.connect(ep)).rejects.toThrow('stop before session creation')

    expect(usedUrls).toEqual(['opc.wss://other-host:4840'])
  })

  it('keeps the constructor endpointUrl when no endpoint is passed', async () => {
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any

    const usedUrls: string[] = []
    c.openTransportAndChannel = vi.fn().mockImplementation(async () => {
      usedUrls.push(c.endpointUrl)
      throw new Error('stop before session creation')
    })

    await expect(client.connect()).rejects.toThrow('stop before session creation')

    expect(usedUrls).toEqual(['opc.wss://localhost:4840'])
  })
})
