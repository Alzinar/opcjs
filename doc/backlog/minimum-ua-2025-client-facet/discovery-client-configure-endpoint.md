# Discovery Client Configure Endpoint

**Facet**: Minimum UA 2025 Client Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The client must allow specification of an endpoint directly, without going through the Discovery Service Set. This is the most common practical scenario: an operator or configuration file supplies the endpoint URL directly.

**Client responsibilities**:
- Accept a configured `endpointUrl` (e.g. `opc.tcp://host:4840`) as input without requiring a prior `FindServers` or `GetEndpoints` discovery call.
- Use `GetEndpoints` on the configured URL to retrieve the available `EndpointDescription` entries and let the user or configuration select the desired security policy and message security mode.
- Alternatively, accept a fully pre-configured `EndpointDescription` (including security policy, mode, and server certificate) to bypass `GetEndpoints` entirely.

## Implementation

`Client` is constructed with a configured `endpointUrl` directly — no discovery call is required
to connect. `Client.getEndpoints()` (backed by
[`DiscoveryService.getEndpoints()`](../../../packages/client/src/services/discoveryService.ts))
opens a transient SecureChannel to that URL and issues `GetEndpoints`, letting the caller inspect
the available `EndpointDescription` entries before connecting. `Client.connect(endpoint?)` accepts
an optional pre-selected `EndpointDescription`, whose `endpointUrl` is then used to open the
SecureChannel, bypassing an internal `GetEndpoints` round-trip entirely. See
[client.ts](../../../packages/client/src/client.ts) and
[discoveryConnect.test.ts](../../../packages/client/tests/unit/discoveryConnect.test.ts) /
[discoveryService.test.ts](../../../packages/client/tests/unit/discoveryService.test.ts).

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.4.3 | GetEndpoints Service |
| OPC 10000-4 | §5.4.2 | FindServers Service |
| profiles.opcfoundation.org | [CU 2751](https://profiles.opcfoundation.org/conformanceunit/2751) | Discovery Client Configure Endpoint |
