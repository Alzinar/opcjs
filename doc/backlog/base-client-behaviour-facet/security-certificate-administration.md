# Security Certificate Administration

**Facet**: Base Client Behaviour Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Implementation

- `SecurityConfiguration.applicationInstanceCertificate` (`packages/client/src/securityConfiguration.ts`) lets an administrator configure a site-specific `ApplicationInstanceCertificate`; `SessionHandler.createNewSession()` now sends it proactively as `clientCertificate` on every `CreateSession` request instead of only as a 1.0-compatibility retry fallback.
- `SecurityConfiguration.privateKey` stores the matching private key alongside the certificate. It is not yet used to compute request signatures since this client only implements `SecurityPolicy#None` (which does not sign requests) — it will be wired in once a signing security policy is added.
- `trustedCAs` / `unknownCertificatePolicy` (pre-existing) remain available to configure a trusted CA list for server certificate validation.
- Full PKI directory management, CRL/OCSP revocation checking and certificate generation/renewal are out of scope for this CU — see the separate optional [Security Admin – Certificate Management](../core-2022-client-facet/security-admin-certificate-management.md) CU, which remains ❌.

## Description

The client must allow a site administrator to assign a site-specific `ApplicationInstanceCertificate` and, if desired, configure a site-specific Certificate Authority (CA).

**Client responsibilities**:
- Provide a mechanism (UI, CLI, or configuration file) to replace the default `ApplicationInstanceCertificate` with a site-issued certificate.
- Optionally allow the administrator to configure a private CA whose issued certificates will be trusted.
- Store the certificate and private key securely in the application's certificate store.
- Use the configured certificate in all `CreateSession` requests.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-6 | §6.2 | Application Instance Certificates |
| profiles.opcfoundation.org | [CU 2319](https://profiles.opcfoundation.org/conformanceunit/2319) | Security Certificate Administration |
