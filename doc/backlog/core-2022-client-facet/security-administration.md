# Security Administration

**Facet**: Core 2022 Client Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The Security Administration conformance unit requires that a client provides administrative controls over its security configuration, including:

1. **User Token Policy selection** — the client must be able to select among the user token policies advertised by the server (Anonymous, UserName, X.509 Certificate, IssuedToken).
2. **SecurityPolicy selection** — the client must allow or disallow specific security policies (e.g. prohibit `SecurityPolicy#None` in production deployments).
3. **MessageSecurityMode selection** — the client must be configurable to require `Sign` or `SignAndEncrypt` modes and refuse `None` when security is mandatory.
4. **Trusted Certificate Authorities** — the client must allow the operator to configure a set of trusted CA certificates used to validate server certificates.
5. **Unknown Certificate Policy** — the client must define its behaviour when an untrusted or unknown server certificate is presented (reject, prompt, or auto-trust).

### Security Policies (OPC 10000-7)

The following security policies are defined by the specification. A client claiming this CU must at minimum support `None` (for initial connectivity) and should support at least one secure policy:

| Security Policy | URI |
|----------------|-----|
| None | `http://opcfoundation.org/UA/SecurityPolicy#None` |
| Basic256Sha256 | `http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256` |
| Aes128_Sha256_RsaOaep | `http://opcfoundation.org/UA/SecurityPolicy#Aes128_Sha256_RsaOaep` |
| Aes256_Sha256_RsaPss | `http://opcfoundation.org/UA/SecurityPolicy#Aes256_Sha256_RsaPss` |

### MessageSecurityMode

Defined in OPC 10000-4 §7.15:

| Mode | Value | Description |
|------|-------|-------------|
| None | 1 | No security |
| Sign | 2 | Messages are signed |
| SignAndEncrypt | 3 | Messages are signed and encrypted |

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-2 §4 | Security Model | Threat model and security requirements |
| OPC 10000-2 §4.4 | Application Authentication | Certificate-based application identity |
| OPC 10000-4 §5.5.1 | GetEndpoints | Endpoint retrieval including security policies |
| OPC 10000-4 §5.6.2 | OpenSecureChannel | Negotiation of SecurityPolicy and MessageSecurityMode |
| OPC 10000-4 §7.15 | MessageSecurityMode | Enumeration of modes |
| OPC 10000-6 §6.1 | Security Policies | List of defined security policies with algorithm details |
| OPC 10000-7 §6 | Core 2022 Client Facet | Security Administration listed as required CU |

Online: https://reference.opcfoundation.org/Core/Part2/v105/docs/4  
Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/5.6.2  
Online: https://reference.opcfoundation.org/Core/Part6/v105/docs/6.1

## Implementation

**Files**:
- `src/securityConfiguration.ts` — `SecurityConfiguration` type with:
  - `allowSecurityPolicyNone: boolean`
  - `messageSecurityMode: MessageSecurityMode`
  - `allowedUserTokenTypes: UserTokenType[]`
  - `applicationInstanceCertificate?: ApplicationInstanceCertificate`
  - `certificateStore?: ICertificateStore` / `validateServerCertificate?: (...)` — see [Security Admin – Certificate Management](./security-admin-certificate-management.md)
- `src/client.ts` — enforces `allowSecurityPolicyNone` and `messageSecurityMode` at connection time.
- `src/sessions/sessionHandler.ts` — enforces `allowedUserTokenTypes` during `ActivateSession`.

## Open Items

Certificate validation is now implemented via `ICertificateStore` —
see [Security Admin – Certificate Management](./security-admin-certificate-management.md) for the optional CU that extends this.

## Related Conformance Units

- [Security Admin – Certificate Management](./security-admin-certificate-management.md) (optional)
- [SecurityPolicy – None](../security-policy-none/README.md)
- [User Token – Anonymous Client](../user-token-anonymous-client/security-user-anonymous-client.md)
