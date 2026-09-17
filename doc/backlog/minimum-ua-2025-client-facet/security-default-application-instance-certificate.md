# Security Default ApplicationInstance Certificate

**Facet**: Minimum UA 2025 Client Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

When installed, an OPC UA application must have a default `ApplicationInstanceCertificate` that is valid. The certificate must either be:
- created automatically as part of the installation process, or
- described in installation instructions so the operator can create and apply one.

This ensures that every deployed instance has a unique, valid certificate identity from day one, which is required for establishing secure channels with servers.

**Client responsibilities**:
- Ship with tooling or instructions that generate a self-signed or CA-signed `ApplicationInstanceCertificate` on first run or installation.
- Store the certificate and its private key in the application's certificate store.
- Present the certificate in `CreateSessionRequest.clientCertificate` when using any security policy other than `None`.

## Implementation

`Client.connect()` resolves the certificate store on first use (`resolveCertificateStore()` in
[client.ts](../../../packages/client/src/client.ts)) and calls the new
`ensureDefaultOwnCertificate()` step: if `ICertificateStore.getOwn()` reports no own certificate
yet, a self-signed `ApplicationInstanceCertificate` + RSA key pair is generated automatically via
`ICertificateStore.generateOwn()`, using `ConfigurationClient.applicationUri` /
`applicationName` as the certificate subject. The generated certificate is persisted by the
platform-specific store (`FileSystemCertificateStore` under Node.js, `IndexedDbCertificateStore`
in a browser) and is then picked up by the existing `SessionHandler.createNewSession()` fallback,
which sends it as `CreateSessionRequest.clientCertificate`.

This only applies to the client's own default store; a caller-supplied
`securityConfiguration.certificateStore` is assumed to already be provisioned by its owner and is
left untouched.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-6 | §6.2 | Application Instance Certificates |
| profiles.opcfoundation.org | [CU 3080](https://profiles.opcfoundation.org/conformanceunit/3080) | Security Default ApplicationInstance Certificate |
