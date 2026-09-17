# Security Admin – Certificate Management

**Facet**: Core 2022 Client Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The Security Admin – Certificate Management conformance unit extends the [Security Administration](./security-administration.md) required CU with active certificate lifecycle management capabilities:

1. **Trust list management** — the client exposes an API to add / remove trusted CA certificates and individual application certificates.
2. **Certificate store** — certificates and private keys are stored in a persistent, OS-protected location (e.g. Windows Certificate Store, Linux file-based PKI directory).
3. **Certificate revocation** — the client can check CRL (Certificate Revocation List) or use OCSP to determine whether a server certificate has been revoked.
4. **Self-signed certificate generation** — the client can generate its own self-signed application instance certificate for use in secure connections.
5. **Certificate renewal** — the client can renew its own certificate before it expires.

### OPC UA PKI directory structure (OPC 10000-6 §6.2)

```
pki/
  own/
    certs/         # Application instance certificates (own)
    private/       # Private keys
  trusted/
    certs/         # Trusted server certificates and CA certs
    crl/           # Certificate Revocation Lists
  rejected/
    certs/         # Auto-rejected server certificates (for manual review)
  issuers/
    certs/         # Issuer (intermediate CA) certificates
    crl/           # Issuer CRLs
```

### Certificate validation procedure (OPC 10000-6 §6.2)

When the client receives a server certificate during `CreateSession`:
1. Check that the certificate is syntactically valid (X.509 v3).
2. Check the `Subject Alternative Names` extension includes the server's `applicationUri`.
3. Build a chain from the server certificate to a trusted root CA.
4. Verify no certificate in the chain appears in a CRL.
5. Check that none of the certificates in the chain have expired.
6. Apply the `unknownCertificatePolicy` if the chain cannot be completed.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-2 §4.4 | Application Authentication | Certificate-based identity model |
| OPC 10000-6 §6.2 | Certificate Management | PKI directory layout and validation rules |
| OPC 10000-6 §6.2.4 | Issuer Certificates | Intermediate CA handling |
| OPC 10000-6 §6.2.5 | CRL | Revocation checking |
| OPC 10000-12 §6 | GDS Pull Model | Certificate management via GDS server |

Online: https://reference.opcfoundation.org/Core/Part2/v105/docs/4.4  
Online: https://reference.opcfoundation.org/Core/Part6/v105/docs/6.2

## Implementation

Implemented in `opcjs-base` (shared, isomorphic) and wired into `opcjs-client` and `opcjs-server`:

- `ICertificateStore` (packages/base/src/certificates/iCertificateStore.ts) — `addTrusted()`, `removeTrusted()`, `listTrusted()`, `reject()`, `listRejected()`, `getOwn()`, `generateOwn()`, `renewOwn()`, `validate()`. Certificate parsing, chain building, CRL matching, and self-signed generation are implemented on top of `@peculiar/x509` + the WebCrypto API (`certificateCrypto.ts`), so the validation logic is written once and shared by both storage backends below.
- `FileSystemCertificateStore` (packages/base/src/certificates/fileSystemCertificateStore.ts) — Node.js implementation using `node:fs/promises`, laid out per the OPC UA PKI directory structure below. Deliberately **not** re-exported from `opcjs-base`'s main entry point (only reachable via `createDefaultCertificateStore()`) because a static re-export breaks browser bundlers (Vite fails hard resolving `node:fs/promises`/`node:path` through its browser-external shim when the module is reachable from the bundled entry).
- `IndexedDbCertificateStore` (packages/base/src/certificates/indexedDbCertificateStore.ts) — browser implementation backed by IndexedDB, storing the own private key as a non-extractable `CryptoKey` rather than exported raw bytes.
- `createDefaultCertificateStore()` (packages/base/src/certificates/createDefaultCertificateStore.ts) — picks the right implementation for the current environment via `isNodeLike()`.
- `SecurityConfiguration.certificateStore` and `SecurityConfiguration.validateServerCertificate` (packages/client/src/securityConfiguration.ts) — the latter is a caller-overridable callback (not part of `ICertificateStore`) defaulting to `(cert, store, uri) => store.validate(cert, uri)`, so a user can plug in custom validation without reimplementing the store.
- `SessionHandler.createNewSession()` (packages/client/src/sessions/sessionHandler.ts) — lazily creates/memoizes the default certificate store, falls back to the store's own certificate for `CreateSession` when `applicationInstanceCertificate` isn't explicitly configured, and validates the server's certificate from `CreateSessionResponse` before activating the session, throwing `ServerCertificateRejectedError` on rejection.
- Server reuse: `ConfigurationServer.certificateStore` (packages/server/src/configuration/configurationServer.ts) lets a server supply its own `ICertificateStore`; `SessionService.createSession()` (packages/server/src/services/sessionService.ts) uses `store.getOwn()` to populate `CreateSessionResponse.serverCertificate` when configured (`null` otherwise, preserving prior behaviour). Full server-side validation of incoming client certificates / RBAC is out of scope here and remains tracked separately (see Security Administration, Security Role Server Authorization in the Core 2022 Server Facet).
- Round-trip integration test: packages/base/tests/integration/certificateStore.test.ts exercises `FileSystemCertificateStore` end-to-end against a real temp directory (generate own cert, trust/validate/reject/remove, renew).

## Implementation Gap (historical, prior to this CU's implementation)

The `trustedCAs` and `unknownCertificatePolicy` fields were stored in `SecurityConfiguration` but not actively used, and have since been removed: the trust list now lives in `ICertificateStore`, and unknown-certificate handling is the `validateServerCertificate` callback (see Implementation above).

## Work Required

1. Implement an `ICertificateStore` interface with `addTrusted()`, `removeTrusted()`, `listTrusted()`, `reject()`, `getOwn()` operations.
2. Implement X.509 chain validation using the Web Crypto API or a Node.js crypto library.
3. Implement CRL loading and revocation checking.
4. Wire `ICertificateStore` into `SessionHandler.createNewSession()` to validate the server certificate received in `CreateSessionResponse`.
5. Add a self-signed certificate generation utility.

## Related Conformance Units

- [Security Administration](./security-administration.md) (required, prerequisite)
- [SecurityPolicy – None](../security-policy-none/README.md)
