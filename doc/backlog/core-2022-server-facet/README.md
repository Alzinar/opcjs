# Core 2022 Server Facet

**Specification**: OPC 10000-7 §6.x (Profiles), version 1.05  
**Profile URI**: `http://opcfoundation.org/UA-Profile/Server/Core2022Facet`  
**Category**: Server  

## Overview

The Core 2022 Server Facet defines the core functionality required for any UA Server implementation.
It supersedes the Core 2017 Server Facet.

The core functionality includes:
- Discovering endpoints
- Establishing secure communication channels
- Creating Sessions
- Browsing the AddressSpace
- Reading and/or writing Attributes of Nodes

Key requirements: support for minimum one Session, the core AddressSpace structure and the Server Capabilities Object, and authentication with UserName and Password.
For broad applicability, it is recommended that Servers support multiple transport and security Profiles.

A server claiming conformance to this facet must also conform to all **mandatory dependencies**:

| Dependency Facet | Folder |
|-----------------|--------|
| UA-TCP UA-SC UA-Binary | [../ua-tcp-ua-sc-ua-binary/](../ua-tcp-ua-sc-ua-binary/) |
| SecurityPolicy – None | [../security-policy-none/](../security-policy-none/) |
| Security Time Synchronization | [../security-time-synchronization/](../security-time-synchronization/) |
| User Token – Anonymous Server | [../user-token-anonymous-server/](../user-token-anonymous-server/) |
| User Token – User Name Password Server | [../user-token-user-name-password-server/](../user-token-user-name-password-server/) |

## Required Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [address-space-atomicity.md](./address-space-atomicity.md) | Address Space Atomicity |
| ✅ | [address-space-base.md](./address-space-base.md) | Address Space Base |
| ✅ | [address-space-full-array-only.md](./address-space-full-array-only.md) | Address Space Full Array Only |
| ✅ | [attribute-read.md](./attribute-read.md) | Attribute Read |
| ✅ | [base-info-core-structure-2.md](./base-info-core-structure-2.md) | Base Info Core Structure 2 |
| ✅ | [base-info-server-capabilities-2.md](./base-info-server-capabilities-2.md) | Base Info Server Capabilities 2 |
| ✅ | [discovery-find-servers-self.md](./discovery-find-servers-self.md) | Discovery Find Servers Self |
| ✅ | [discovery-get-endpoints.md](./discovery-get-endpoints.md) | Discovery Get Endpoints |
| ✅ | [documentation-core-capacities.md](./documentation-core-capacities.md) | Documentation – Core Capacities |
| ✅ | [security-policy-support.md](./security-policy-support.md) | SecurityPolicy Support |
| ✅ | [session-base.md](./session-base.md) | Session Base |
| ✅ | [session-general-service-behaviour.md](./session-general-service-behaviour.md) | Session General Service Behaviour |
| ✅ | [view-basic-2.md](./view-basic-2.md) | View Basic 2 |
| ✅ | [view-register-nodes.md](./view-register-nodes.md) | View RegisterNodes |
| ✅ | [view-translate-browse-path.md](./view-translate-browse-path.md) | View TranslateBrowsePath |

## Optional Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [address-space-addin-default-instance-browsename.md](./address-space-addin-default-instance-browsename.md) | Address Space AddIn DefaultInstanceBrowsename |
| ✅ | [address-space-addin-reference.md](./address-space-addin-reference.md) | Address Space AddIn Reference |
| ✅ | [address-space-interfaces.md](./address-space-interfaces.md) | Address Space Interfaces |
| ✅ | [address-space-non-volatile-and-constant.md](./address-space-non-volatile-and-constant.md) | Address Space NonVolatile and Constant |
| ✅ | [attribute-write-index.md](./attribute-write-index.md) | Attribute Write Index |
| ✅ | [attribute-write-statuscode-and-timestamp.md](./attribute-write-statuscode-and-timestamp.md) | Attribute Write StatusCode & Timestamp |
| ✅ | [attribute-write-values.md](./attribute-write-values.md) | Attribute Write Values |
| ✅ | [base-info-core-views-folder.md](./base-info-core-views-folder.md) | Base Info Core Views Folder |
| ✅ | [base-info-currency.md](./base-info-currency.md) | Base Info Currency |
| ❌ | [base-info-diagnostics.md](./base-info-diagnostics.md) | Base Info Diagnostics |
| ✅ | [base-info-engineering-units.md](./base-info-engineering-units.md) | Base Info Engineering Units |
| ✅ | [base-info-estimated-return-time.md](./base-info-estimated-return-time.md) | Base Info Estimated Return Time |
| ✅ | [base-info-local-time.md](./base-info-local-time.md) | Base Info LocalTime |
| ✅ | [base-info-locations-object.md](./base-info-locations-object.md) | Base Info Locations Object |
| ✅ | [base-info-namespace-metadata.md](./base-info-namespace-metadata.md) | Base Info Namespace Metadata |
| ✅ | [base-info-option-set.md](./base-info-option-set.md) | Base Info OptionSet |
| ✅ | [base-info-selection-list.md](./base-info-selection-list.md) | Base Info Selection List |
| ✅ | [base-info-value-as-text.md](./base-info-value-as-text.md) | Base Info ValueAsText |
| ❌ | [base-services-diagnostics.md](./base-services-diagnostics.md) | Base Services Diagnostics |
| ❌ | [security-administration.md](./security-administration.md) | Security Administration |
| ❌ | [security-role-server-authorization.md](./security-role-server-authorization.md) | Security Role Server Authorization |
| ✅ | [session-change-user.md](./session-change-user.md) | Session Change User |

### Summary

| Total | Implemented | Partial | Missing |
|-------|-------------|---------|---------|
| Required: 15 | 15 | 0 | 0 |
| Optional: 22 | 18 | 0 | 4 |

## Implementation Notes

- Implementation lives under `packages/server/src/`:
  - `services/discoveryService.ts` — `GetEndpoints` / `FindServers` (SecurityPolicy None, anonymous token policy, single WS endpoint).
  - `services/sessionService.ts` + `sessions/sessionManager.ts` — `CreateSession` / `ActivateSession` / `CloseSession`, timeout scheduling, channel binding. `ActivateSession` can be called again on an already-active session (Session Change User), though only the Anonymous identity token is currently supported.
  - `services/serviceDispatcher.ts` — enforces Session General Service Behaviour (authentication-token checks, `requestHandle` echo, `timeoutHint` enforcement via `isRequestStale()`); routes `Read`/`Write`/`Browse`/`BrowseNext`/`TranslateBrowsePathsToNodeIds`/`RegisterNodes`/`UnregisterNodes` to their services.
  - `services/attributeService.ts` — `Read` with `timestampsToReturn`, `IndexRange`, and `maxAge` support; `Write` with `IndexRange` merging, `AccessLevelEx.WriteFullArrayOnly` enforcement, and conditional `StatusCode`/`Timestamp` write-through.
  - `services/viewService.ts` — `Browse`/`BrowseNext` (with continuation points), `TranslateBrowsePathsToNodeIds`, `RegisterNodes`/`UnregisterNodes`.
  - `addressSpace/addressSpace.ts` + `addressSpace/node.ts` — full in-memory address space: all eight NodeClasses, a forward/inverse `References` graph with the built-in ReferenceType hierarchy, `Root`/`Objects`/`Types`/`Views` entry points, the `Server` object with `ServerStatus`/`ServiceLevel`/`Auditing`/`VendorServerInfo`/`ServerRedundancy`/`LocalTime`/`EstimatedReturnTime`, `ServerCapabilities` (with `OperationLimits`), and a set of representative nodes demonstrating each implemented optional CU (`OptionSetType`, `SelectionListType`, `ValueAsText`, `EngineeringUnits`, `CurrencyUnit`, `NonVolatile`/`Constant`, `Locations`, `Namespaces`, `InterfaceTypes`/`BaseInterfaceType`/`HasInterface`, `HasAddIn`, `DefaultInstanceBrowseName`).
- Remaining gaps (all optional): **Base Info Diagnostics** and **Base Services Diagnostics** (no `ServerDiagnostics` object or `returnDiagnostics`-bitmask handling — `diagnosticInfos` arrays are always populated with empty `DiagnosticInfo` placeholders), and **Security Administration** / **Security Role Server Authorization** (no configurable trust-list/certificate administration surface and no RBAC/role evaluation — every activated session has unrestricted access).
- Only anonymous authentication is implemented (see [../user-token-anonymous-server/](../user-token-anonymous-server/)); there is no username/password support (see [../user-token-user-name-password-server/](../user-token-user-name-password-server/)).
