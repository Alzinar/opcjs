# SecurityPolicy Support

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support at least one Security Policy. Support of `SecurityPolicy#None` is recommended for testing and compatibility reasons, even if the server also supports more secure policies.

**Server responsibilities**:
- Implement at least one of the following security policies:
  - `SecurityPolicy#None` — no security (recommended for test/dev)
  - `SecurityPolicy#Basic256Sha256` — RSA with SHA-256 (recommended)
  - `SecurityPolicy#Aes128_Sha256_RsaOaep` — RSA-OAEP with AES-128 and SHA-256
  - `SecurityPolicy#Aes256_Sha256_RsaPss` — RSA-PSS with AES-256 and SHA-256
  - ECC-based policies (see ECC-nistP256, ECC-nistP384, etc.)
- Expose all supported policies in the endpoints returned by `GetEndpoints`.
- For each secure policy, hold a valid `ApplicationInstanceCertificate` and use it during `OpenSecureChannel`.

**Recommendation**: Servers should support multiple policies and allow the administrator to configure which are enabled and which is the default.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-2 | §4 | Security Model |
| OPC 10000-6 | §7 | Security Policies |
| profiles.opcfoundation.org | [CU 2600](https://profiles.opcfoundation.org/conformanceunit/2600) | SecurityPolicy Support |

## Implementation

**Files**:
- `packages/server/src/services/constants.ts` — `SECURITY_POLICY_NONE` URI
- `packages/server/src/services/discoveryService.ts` — advertises `SecurityPolicy#None` in every `EndpointDescription`

Only `SecurityPolicy#None` is supported — this is explicitly recommended as sufficient by the spec, but no encrypted/signed policy (`Basic256Sha256`, ECC, etc.) is implemented yet.
