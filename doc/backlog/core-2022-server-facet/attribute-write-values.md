# Attribute Write Values

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support writing values to one or more Attributes of one or more Nodes using the `Write` Service.

**Server responsibilities**:
- Handle `WriteRequest` with one or more `WriteValue` entries.
- Each `WriteValue` contains a `NodeId`, `AttributeId`, optional `IndexRange`, and `value` (`DataValue`).
- Check the `AccessLevel` of the target Variable Node; return `Bad_NotWritable` for read-only nodes.
- Apply user access rights (if supported); return `Bad_UserAccessDenied` if the user lacks write permission.
- Return `Bad_TypeMismatch` if the written value has an incompatible data type.
- Return `Bad_OutOfRange` if the written value violates defined range constraints.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.10.4 | Write Service |
| OPC 10000-3 | §5.6.2 | AccessLevel Attribute |
| profiles.opcfoundation.org | [CU 2389](https://profiles.opcfoundation.org/conformanceunit/2389) | Attribute Write Values |

## Implementation

**Files**:
- `packages/server/src/services/attributeService.ts` — `write()`/`writeOne()` handle `WriteRequest`, checking `AccessLevel.CurrentWrite` (`Bad_NotWritable` if unset) and rejecting non-`Value` Attribute writes (`Bad_NotWritable`) and missing/incompatible values (`Bad_TypeMismatch`).
- `packages/server/src/services/serviceDispatcher.ts` — routes `WriteRequest` to `AttributeService`.
- `packages/server/tests/attributeWrite.test.ts` — covers the success and rejection paths.

**Not yet implemented**: user-access-rights-based `Bad_UserAccessDenied` and range-constraint-based `Bad_OutOfRange` are not enforced (there is no per-user role model yet — see [security-role-server-authorization.md](./security-role-server-authorization.md) — and no declared value ranges).
