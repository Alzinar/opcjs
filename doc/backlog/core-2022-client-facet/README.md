# Core 2022 Client Facet

**Specification**: OPC 10000-7 §6.x (Profiles), version 1.05  
**Profile URI**: `http://opcfoundation.org/UA-Profile/Client/Core2022`  
**Category**: Client  

## Overview

The Core 2022 Client Facet defines the baseline set of capabilities that an OPC UA Client must and may implement to interoperate with any OPC UA Server.
It supersedes the earlier Core 2017 Client Facet by adding stricter requirements around security administration, auto-reconnect, and documentation of capacity limits.

A client claiming conformance to this facet must also conform to all **mandatory dependencies**:

| Dependency Facet | Folder |
|-----------------|--------|
| UA-TCP UA-SC UA-Binary | [../ua-tcp-ua-sc-ua-binary/](../ua-tcp-ua-sc-ua-binary/) |
| SecurityPolicy – None | [../security-policy-none/](../security-policy-none/) |
| Security Time Synchronization | [../security-time-synchronization/](../security-time-synchronization/) |
| User Token – Anonymous Client | [../user-token-anonymous-client/](../user-token-anonymous-client/) |

## Required Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [address-space-client-nodeid-idtypes.md](./address-space-client-nodeid-idtypes.md) | Address Space Client NodeId IdTypes |
| ✅ | [documentation-core-capacities.md](./documentation-core-capacities.md) | Documentation – Core Capacities |
| ✅ | [security-administration.md](./security-administration.md) | Security Administration |
| ✅ | [session-client-auto-reconnect.md](./session-client-auto-reconnect.md) | Session Client Auto Reconnect |
| ✅ | [session-client-base.md](./session-client-base.md) | Session Client Base |
| ✅ | [session-client-general-service-behaviour.md](./session-client-general-service-behaviour.md) | Session Client General Service Behaviour |
| ✅ | [session-client-keepalive.md](./session-client-keepalive.md) | Session Client KeepAlive |

## Optional Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [base-info-client-currency.md](./base-info-client-currency.md) | Base Info Client Currency |
| ✅ | [base-info-client-estimated-return-time.md](./base-info-client-estimated-return-time.md) | Base Info Client Estimated Return Time |
| ✅ | [base-info-client-selection-list.md](./base-info-client-selection-list.md) | Base Info Client Selection List |
| ✅ | [base-services-client-diagnostics.md](./base-services-client-diagnostics.md) | Base Services Client Diagnostics |
| ✅ | [security-admin-certificate-management.md](./security-admin-certificate-management.md) | Security Admin – Certificate Management |
| ✅ | [session-client-cancel.md](./session-client-cancel.md) | Session Client Cancel |
| ❌ | [session-client-detect-shutdown.md](./session-client-detect-shutdown.md) | Session Client Detect Shutdown |
| ✅ | [session-client-impersonate.md](./session-client-impersonate.md) | Session Client Impersonate |
| ✅ | [session-client-renew-nodeids.md](./session-client-renew-nodeids.md) | Session Client Renew NodeIds |
