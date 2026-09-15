# Session Change User

**Facet**: Core 2022 Server Facet  
**Type**: Optional  
**Status**: ✅ Implemented  

## Description

The server must support using `ActivateSession` to change the authenticated user of an already-established session without creating a new session. This allows a single session to be reused by different users (e.g. operator login/logout on a shared HMI).

**Server responsibilities**:
- Accept `ActivateSessionRequest` on an existing, already-activated session.
- Validate the new `userIdentityToken` and update the session's identity to the new user.
- Apply any access control changes resulting from the new user's roles immediately.
- Generate a new `serverNonce` in the response for subsequent calls.
- The secure channel must remain the same; only the user identity changes.

**Note**: The base [Session Base](./session-base.md) CU explicitly excludes this capability.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §5.7.3 | ActivateSession Service |
| profiles.opcfoundation.org | [CU 2400](https://profiles.opcfoundation.org/conformanceunit/2400) | Session Change User |

## Implementation

**Files**:
- `packages/server/src/sessions/sessionManager.ts` — `activateSession()` re-validates `userIdentityToken` and rebinds the channel on every call, with no check that the session was already activated — calling `ActivateSession` again on an already-active session (e.g. with a different identity token) is accepted, updates `boundChannelId`/`lastActivityAt`, and reschedules the timeout.
- `packages/server/src/services/sessionService.ts` — `activateSession()` returns a fresh `serverNonce` on every call, as required.

**Caveat**: the server currently only supports the Anonymous identity token (see [../user-token-anonymous-server/](../user-token-anonymous-server/)); username/password is not yet implemented (see [../user-token-user-name-password-server/](../user-token-user-name-password-server/)). The *mechanism* for changing the user on an existing session is fully functional, but there is only one "user" (anonymous) to switch between today.
