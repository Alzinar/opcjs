# Session Base

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented  

## Description

The server must support the Session Service Set: `CreateSession`, `ActivateSession`, and `CloseSession` — except the use of `ActivateSession` to change the session user (that is covered by the optional [Session Change User](./session-change-user.md) CU).

**Server responsibilities**:

### CreateSession
- Validate the `clientDescription`, `serverUri`, and `endpointUrl`.
- Generate a unique `sessionId` (NodeId) and `authenticationToken` (opaque token).
- Generate a fresh `serverNonce` (at least 32 bytes of cryptographic random data).
- Return `serverCertificate` for client certificate validation.
- Return `revisedSessionTimeout` clamped to the server's configured min/max.
- If `SecurityMode = None`: the Application Certificate and Nonce are optional; signatures are null/empty.

### ActivateSession
- Validate the `clientSignature` over `serverCertificate + serverNonce` (when security is enabled).
- Authenticate the user identity using the supplied `userIdentityToken`.
- Generate a new `serverNonce` to be used for the next `ActivateSession` call.
- Bind the session to the current SecureChannel; reject requests on a different channel until re-activated.

### CloseSession
- Delete server-side state for the session.
- If `deleteSubscriptions = true`, delete all subscriptions owned by the session.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.7.2 | CreateSession |
| OPC 10000-4 | §5.7.3 | ActivateSession |
| OPC 10000-4 | §5.7.4 | CloseSession |
| profiles.opcfoundation.org | [CU 3175](https://profiles.opcfoundation.org/conformanceunit/3175) | Session Base |

## Implementation

**Files**:
- `packages/server/src/services/sessionService.ts` — `createSession()`, `activateSession()`, `closeSession()`
- `packages/server/src/sessions/sessionManager.ts` — session store, `authenticationToken` generation, timeout scheduling, channel binding
- `packages/server/src/sessions/session.ts` — per-session state

`CloseSession` with `deleteSubscriptions = true` disposes every `Subscription` owned by the session (see `SubscriptionManager`).
