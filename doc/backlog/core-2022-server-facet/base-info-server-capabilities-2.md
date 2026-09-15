# Base Info Server Capabilities 2

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must expose the `ServerCapabilities` Object under `Server` with the following mandatory members:

| Property / Variable | Description |
|--------------------|-------------|
| `ServerProfileArray` | Array of Profile URIs this server supports |
| `LocaleIdArray` | Array of locale IDs supported for localised text |
| `MinSupportedSampleRate` | Minimum sampling rate, in milliseconds |
| `MaxBrowseContinuationPoints` | Maximum number of simultaneous Browse continuation points per session |
| `ModellingRules` | Folder exposing the supported modelling rules |
| `MaxArrayLength` | Maximum length of array values |
| `MaxStringLength` | Maximum length of string values |
| `MaxByteStringLength` | Maximum length of ByteString values |
| `MaxSessions` | Maximum number of concurrent sessions |

Plus the `OperationLimits` Object with:

| Property | Description |
|----------|-------------|
| `MaxNodesPerRead` | Max nodes per Read request |
| `MaxNodesPerWrite` | Max nodes per Write request |
| `MaxNodesPerBrowse` | Max nodes per Browse request |
| `MaxNodesPerRegisterNodes` | Max nodes per RegisterNodes request |
| `MaxNodesPerTranslateBrowsePathsToNodeIds` | Max paths per TranslateBrowsePathsToNodeIds |

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §8.2 | ServerCapabilities Object |
| profiles.opcfoundation.org | [CU 3912](https://profiles.opcfoundation.org/conformanceunit/3912) | Base Info Server Capabilities 2 |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateServerObject()` creates the `ServerCapabilities` Object (`i=2268`, typed `ServerCapabilitiesType`) under `Server`, with `ServerProfileArray`, `LocaleIdArray`, `MinSupportedSampleRate`, `MaxBrowseContinuationPoints`, `MaxArrayLength`, `MaxStringLength`, `MaxByteStringLength`, `MaxSessions` (custom `ns=1` NodeId, since the spec leaves it vendor-defined), a `ModellingRules` Folder, and an `OperationLimits` Object exposing `MaxNodesPerRead`, `MaxNodesPerWrite`, `MaxNodesPerBrowse`, `MaxNodesPerRegisterNodes`, and `MaxNodesPerTranslateBrowsePathsToNodeIds`.
- `packages/server/src/addressSpace/wellKnownIds.ts` — well-known NodeIds for all of the above.
