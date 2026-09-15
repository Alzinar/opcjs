# View TranslateBrowsePath

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support the `TranslateBrowsePathsToNodeIds` Service, which allows clients to resolve a sequence of `BrowseName` steps from a starting node to a target NodeId without needing to perform multiple Browse calls.

**Server responsibilities**:
- Handle `TranslateBrowsePathsToNodeIdsRequest` with one or more `BrowsePath` entries.
- Each `BrowsePath` consists of:
  - `startingNode` — the NodeId of the starting node
  - `relativePath` — a sequence of `RelativePathElement` steps, each containing a `referenceTypeId`, `isInverse`, `includeSubtypes`, and `targetName` (BrowseName)
- For each step, follow the matching reference from the current node to the next.
- Return `BrowsePathResult` with `targets` (array of `BrowsePathTarget` including `targetId` and `remainingPathIndex`).
- Return `Bad_NoMatch` if no matching path is found.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.8.4 | TranslateBrowsePathsToNodeIds Service |
| OPC 10000-4 | §7.31 | RelativePath |
| profiles.opcfoundation.org | [CU 2317](https://profiles.opcfoundation.org/conformanceunit/2317) | View TranslateBrowsePath |

## Implementation

**Files**:
- `packages/server/src/services/viewService.ts` — `translateBrowsePathsToNodeIds()`/`translateOne()` walk each `RelativePathElement` (`referenceTypeId`, `isInverse`, `includeSubtypes`, `targetName`) from the starting node, following matching references at each step and fanning out across multiple matches; returns `Bad_NodeIdUnknown` for an unknown starting node and `Bad_NoMatch` when no target is found.
- `packages/server/src/services/serviceDispatcher.ts` — routes `TranslateBrowsePathsToNodeIdsRequest` to `ViewService` (no session required, per spec).
