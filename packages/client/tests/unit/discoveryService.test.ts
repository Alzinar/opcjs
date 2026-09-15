/**
 * Unit tests for `DiscoveryService.getEndpoints()` — Discovery Client Configure
 * Endpoint conformance unit (OPC UA Part 4, §5.4.4).
 */

import { describe, expect, it, vi } from 'vitest'

import { EndpointDescription, GetEndpointsRequest, GetEndpointsResponse, StatusCode } from 'opcjs-base'

import { DiscoveryService } from '../../src/services/discoveryService.js'

function makeChannel(endpoints: EndpointDescription[]) {
  const response = new GetEndpointsResponse()
  response.responseHeader = { serviceResult: StatusCode.Good } as GetEndpointsResponse['responseHeader']
  response.endpoints = endpoints

  return {
    issueServiceRequest: vi.fn().mockResolvedValue(response),
  }
}

describe('DiscoveryService.getEndpoints', () => {
  it('sends a GetEndpointsRequest with the given endpointUrl and returns the endpoints', async () => {
    const ep = new EndpointDescription()
    ep.endpointUrl = 'opc.wss://server:4840'
    const channel = makeChannel([ep])

    const service = new DiscoveryService(channel as unknown as ConstructorParameters<typeof DiscoveryService>[0])
    const result = await service.getEndpoints('opc.wss://server:4840')

    expect(result).toEqual([ep])
    expect(channel.issueServiceRequest).toHaveBeenCalledOnce()
    const sentRequest = channel.issueServiceRequest.mock.calls[0][0] as GetEndpointsRequest
    expect(sentRequest).toBeInstanceOf(GetEndpointsRequest)
    expect(sentRequest.endpointUrl).toBe('opc.wss://server:4840')
  })

  it('returns an empty array when the server reports no endpoints', async () => {
    const channel = makeChannel([])
    const service = new DiscoveryService(channel as unknown as ConstructorParameters<typeof DiscoveryService>[0])

    const result = await service.getEndpoints('opc.wss://server:4840')

    expect(result).toEqual([])
  })

  it('throws when the server returns a non-Good serviceResult', async () => {
    const response = new GetEndpointsResponse()
    response.responseHeader = { serviceResult: StatusCode.BadInternalError } as GetEndpointsResponse['responseHeader']
    response.endpoints = []
    const channel = { issueServiceRequest: vi.fn().mockResolvedValue(response) }

    const service = new DiscoveryService(channel as unknown as ConstructorParameters<typeof DiscoveryService>[0])

    await expect(service.getEndpoints('opc.wss://server:4840')).rejects.toThrow()
  })
})
