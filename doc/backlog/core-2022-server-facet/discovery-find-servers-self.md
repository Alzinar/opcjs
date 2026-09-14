# Discovery Find Servers Self

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support the `FindServers` Service, but only for reporting itself. It does not need to act as a discovery aggregator for other servers.

**Server responsibilities**:
- Handle `FindServersRequest` and return a `FindServersResponse` containing the server's own `ApplicationDescription`.
- The `ApplicationDescription` must include:
  - `ApplicationUri` — globally unique URI identifying the server application
  - `ProductUri` — URI identifying the product
  - `ApplicationName` — localised name of the application
  - `ApplicationType` — `Server` (0)
  - `DiscoveryUrls` — at least one endpoint URL where clients can connect

**Note**: The server is not required to support the Local Discovery Server (LDS) registration in this CU; that is optional.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.4.2 | FindServers Service |
| profiles.opcfoundation.org | [CU 2352](https://profiles.opcfoundation.org/conformanceunit/2352) | Discovery Find Servers Self |

## Implementation

**Files**:
- `packages/server/src/services/discoveryService.ts` — `findServers()` returns the server's own `ApplicationDescription` (`applicationUri`, `productUri`, `applicationName`, `applicationType = Server`, `discoveryUrls`).
