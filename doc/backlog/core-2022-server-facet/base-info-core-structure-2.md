# Base Info Core Structure 2

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must expose the base entry points and server object in the AddressSpace:

- **Root** — the root node (`NodeId = i=84`)
- **Objects** — the Objects folder (`NodeId = i=85`), the standard entry point for browsable object instances
- **Server Object** — (`NodeId = i=2253`) with the following mandatory child variables:
  - `ServerArray` — array of server URIs known to this server
  - `NamespaceArray` — array of namespace URIs
  - `ServerStatus` — current server state, build info, start time, current time, seconds till shutdown, shutdown reason
  - `ServiceLevel` — 0–255 quality indicator for load balancing
  - `Auditing` — Boolean indicating whether audit events are generated
  - Entry point to `VendorServerInfo` Object
  - Entry point to `ServerRedundancy` Object

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §8.2 | Server Object |
| OPC 10000-3 | §8.2.4 | AddressSpace entry points |
| profiles.opcfoundation.org | [CU 3184](https://profiles.opcfoundation.org/conformanceunit/3184) | Base Info Core Structure 2 |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateCoreStructure()` creates `Root` (i=84), `Objects` (i=85), `Types` (i=86), `Views` (i=87) and their `ObjectTypes`/`VariableTypes`/`DataTypes`/`ReferenceTypes` sub-folders (all `Organizes`-linked and typed `FolderType`). `populateServerObject()` creates the `Server` Object (i=2253) with `ServerArray` (i=2254), `NamespaceArray` (i=2255), a full `ServerStatus` (i=2256, `ServerStatusDataType` with live `BuildInfo`, `StartTime`, `CurrentTime`, `State`), `ServiceLevel` (i=2267), `Auditing` (i=2994), `VendorServerInfo` (i=2295), and `ServerRedundancy` (i=2296).

All previously-missing pieces (`Root`/`Objects` entry points, the full `ServerStatusDataType` structure, `ServiceLevel`, `Auditing`, `VendorServerInfo`, `ServerRedundancy`) are now implemented.
