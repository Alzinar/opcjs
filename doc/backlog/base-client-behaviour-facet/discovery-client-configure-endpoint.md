# Discovery Client Configure Endpoint

**Facet**: Base Client Behaviour Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Implementation

- `Client.getEndpoints()` (`packages/client/src/client.ts`) opens a transient SecureChannel to the configured `endpointUrl` and issues a `GetEndpointsRequest` via the new `DiscoveryService` (`packages/client/src/services/discoveryService.ts`), returning the `EndpointDescription[]` for the caller to inspect and choose from.
- `Client.connect(endpoint?: EndpointDescription)` accepts a pre-selected `EndpointDescription` (e.g. from `getEndpoints()` or a config file), using its `endpointUrl` directly and bypassing the internal endpoint round-trip. The existing constructor `endpointUrl` remains the default when no endpoint is passed.
- Cross-SDK interop coverage: `ref/opcjs/RefClient/tests/uaNet.test.ts`, `open62541.test.ts` and `opcjs.test.ts` each call `Client.getEndpoints()` against a real reference server (uaNet, open62541, opcjs) and assert the returned `EndpointDescription[]` is well-formed.

## Description

The client must allow specification of an endpoint directly, without going through the Discovery Service Set. This is the most common practical scenario: an operator or configuration file supplies the endpoint URL directly.

**Client responsibilities**:
- Accept a configured `endpointUrl` (e.g. `opc.tcp://host:4840`) as input without requiring a prior `FindServers` or `GetEndpoints` discovery call.
- Use `GetEndpoints` on the configured URL to retrieve the available `EndpointDescription` entries and let the user or configuration select the desired security policy and message security mode.
- Alternatively, accept a fully pre-configured `EndpointDescription` (including security policy, mode, and server certificate) to bypass `GetEndpoints` entirely.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.4.3 | GetEndpoints Service |
| OPC 10000-4 | §5.4.2 | FindServers Service |
| profiles.opcfoundation.org | [CU 2751](https://profiles.opcfoundation.org/conformanceunit/2751) | Discovery Client Configure Endpoint |
