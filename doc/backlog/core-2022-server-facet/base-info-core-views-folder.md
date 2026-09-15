# Base Info Core Views Folder

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must expose the `Views` folder as the standard entry point into View nodes in the AddressSpace (`NodeId = i=87`).

**Server responsibilities**:
- Expose the `Views` folder under `Root` as a `FolderType` Object.
- Organise any server-defined View nodes as children of this folder.
- Clients browsing from `Root` should be able to navigate to Views via the hierarchy: `Root → Views`.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-5 | §8.2 | Standard AddressSpace structure |
| profiles.opcfoundation.org | [CU 3186](https://profiles.opcfoundation.org/conformanceunit/3186) | Base Info Core Views Folder |

## Implementation

**Files**:
- `packages/server/src/addressSpace/addressSpace.ts` — `populateCoreStructure()` creates `Views` (i=87) typed `FolderType`, `Organizes`-linked from `Root`, and organises a representative `ServerView` (`ns=1;i=1`, `ViewNode`) as its child.
