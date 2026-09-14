# Session General Service Behaviour

**Facet**: Core 2022 Server Facet  
**Type**: Required  
**Status**: ⚠️ Partially Implemented  

## Description

The server must implement basic service behaviour for all services within a session.

**Server responsibilities**:
- **Authentication token check**: Every request in a session must carry the `authenticationToken` received during `CreateSession`. Reject requests with an unknown or mismatched token with `Bad_SessionIdInvalid` or `Bad_SessionClosed`.
- **RequestHandle echo**: Return the `requestHandle` supplied by the client in the `ResponseHeader` of every response, so clients can correlate asynchronous responses.
- **TimeoutHint**: Respect the `timeoutHint` in the `RequestHeader`. If the server cannot complete the request within the hint (in milliseconds), it should return a service fault rather than process indefinitely.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 | §7.28 | RequestHeader |
| OPC 10000-4 | §7.29 | ResponseHeader |
| OPC 10000-4 | §5.7 | Session Service Set |
| profiles.opcfoundation.org | [CU 3985](https://profiles.opcfoundation.org/conformanceunit/3985) | Session General Service Behaviour |

## Implementation

**Files**:
- `packages/server/src/services/serviceDispatcher.ts` — validates `authenticationToken` before dispatching, returns `ServiceFault` with the correct status code on failure
- `packages/server/src/services/responseHeader.ts` — `makeResponseHeader()` echoes `requestHandle` on every response

**Not yet implemented**:
- `timeoutHint` from the `RequestHeader` is not read or enforced anywhere — requests are processed to completion regardless of the client's hint.
