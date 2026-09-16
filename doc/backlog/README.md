# OPC UA Client – Conformance Backlog

This directory tracks implementation status against OPC UA 1.05 conformance requirements, organised by facet.  
Each facet has its own folder; each conformance unit has its own document.

## Facets

| Folder | Facet | Required by | Required CUs | Optional CUs |
|--------|-------|-------------|--------------|--------------|
| [core-2022-client-facet/](./core-2022-client-facet/) | Core 2022 Client Facet | Minimum UA Client 2022 Profile | 7 / 7 ✅ | 7 ✅ · 2 ❌ |
| [ua-tcp-ua-sc-ua-binary/](./ua-tcp-ua-sc-ua-binary/) | UA-TCP UA-SC UA-Binary | Client & Server Core dependency | 3 / 3 ✅ | — |
| [security-policy-none/](./security-policy-none/) | SecurityPolicy – None | Client & Server Core dependency | 7 / 7 ✅ | 1 / 1 ✅ |
| [security-time-synchronization/](./security-time-synchronization/) | Security Time Synchronization | Client & Server Core dependency | 1 / 1 ✅ | 1 ✅ · 5 ❌ |
| [user-token-anonymous-client/](./user-token-anonymous-client/) | User Token – Anonymous Client | Core 2022 Client Facet (dependency) | 1 / 1 ✅ | — |
| [user-token-anonymous-server/](./user-token-anonymous-server/) | User Token – Anonymous Server | Core 2022 Server Facet (dependency) | 1 / 1 ✅ | — |
| [user-token-user-name-password-server/](./user-token-user-name-password-server/) | User Token – User Name Password Server | Core 2022 Server Facet (dependency) | 0 / 2 ❌ | 1 ❌ |
| [minimum-ua-2025-client-facet/](./minimum-ua-2025-client-facet/) | Minimum UA 2025 Client Facet | Minimum UA Client 2025 Profile | 0 / 2 ❌ | 1 ❌ |
| [base-client-behaviour-facet/](./base-client-behaviour-facet/) | Base Client Behaviour Facet | Standard UA Client Profiles | 7 / 7 ✅ | — |
| [core-2022-server-facet/](./core-2022-server-facet/) | Core 2022 Server Facet | Nano/Standard UA Server Profiles | 15 / 15 ✅ | 18 ✅ · 4 ❌ |
| [embedded-datachange-subscription-2022-server-facet/](./embedded-datachange-subscription-2022-server-facet/) | Embedded DataChange Subscription 2022 Server Facet | Micro/Standard UA Server Profiles | 10 / 10 ✅ | — |

### Conformance Unit Detail

#### Core 2022 Client Facet — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Address Space Client NodeId IdTypes](./core-2022-client-facet/address-space-client-nodeid-idtypes.md) |
| ✅ | [Documentation – Core Capacities](./core-2022-client-facet/documentation-core-capacities.md) |
| ✅ | [Security Administration](./core-2022-client-facet/security-administration.md) |
| ✅ | [Session Client Auto Reconnect](./core-2022-client-facet/session-client-auto-reconnect.md) |
| ✅ | [Session Client Base](./core-2022-client-facet/session-client-base.md) |
| ✅ | [Session Client General Service Behaviour](./core-2022-client-facet/session-client-general-service-behaviour.md) |
| ✅ | [Session Client KeepAlive](./core-2022-client-facet/session-client-keepalive.md) |

#### Core 2022 Client Facet — Optional

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Base Info Client Currency](./core-2022-client-facet/base-info-client-currency.md) |
| ✅ | [Base Info Client Estimated Return Time](./core-2022-client-facet/base-info-client-estimated-return-time.md) |
| ✅ | [Base Info Client Selection List](./core-2022-client-facet/base-info-client-selection-list.md) |
| ✅ | [Base Services Client Diagnostics](./core-2022-client-facet/base-services-client-diagnostics.md) |
| ❌ | [Security Admin – Certificate Management](./core-2022-client-facet/security-admin-certificate-management.md) |
| ✅ | [Session Client Cancel](./core-2022-client-facet/session-client-cancel.md) |
| ✅ | [Session Client Detect Shutdown](./core-2022-client-facet/session-client-detect-shutdown.md) |
| ✅ | [Session Client Impersonate](./core-2022-client-facet/session-client-impersonate.md) |
| ✅ | [Session Client Renew NodeIds](./core-2022-client-facet/session-client-renew-nodeids.md) |

#### UA-TCP UA-SC UA-Binary — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Protocol UA TCP](./ua-tcp-ua-sc-ua-binary/protocol-ua-tcp.md) |
| ✅ | [UA Binary Encoding](./ua-tcp-ua-sc-ua-binary/ua-binary-encoding.md) |
| ✅ | [UA Secure Conversation](./ua-tcp-ua-sc-ua-binary/ua-secure-conversation.md) |

#### SecurityPolicy – None — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [AsymmetricEncryptionAlgorithm_None](./security-policy-none/asymmetric-encryption-algorithm-none.md) |
| ✅ | [AsymmetricSignatureAlgorithm_None](./security-policy-none/asymmetric-signature-algorithm-none.md) |
| ✅ | [KeyDerivationAlgorithm_None](./security-policy-none/key-derivation-algorithm-none.md) |
| ✅ | [Security None CreateSession ActivateSession](./security-policy-none/security-none-create-activate-session.md) |
| ✅ | [SecurityPolicy_None_Limits](./security-policy-none/security-policy-none-limits.md) |
| ✅ | [SymmetricEncryptionAlgorithm_None](./security-policy-none/symmetric-encryption-algorithm-none.md) |
| ✅ | [SymmetricSignatureAlgorithm_None](./security-policy-none/symmetric-signature-algorithm-none.md) |

#### SecurityPolicy – None — Optional

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Security None CreateSession ActivateSession 1.0](./security-policy-none/security-none-create-activate-session-v1.md) |

#### Security Time Synchronization — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Time Sync – Support](./security-time-synchronization/time-sync-support.md) *(satisfied via OS-based support)* |

#### Security Time Synchronization — Optional

| Status | Conformance Unit |
|--------|-----------------|
| ❌ | [Time Sync – Configure Clock Skew](./security-time-synchronization/time-sync-configure-clock-skew.md) |
| ❌ | [Time Sync – IEEE 1588 PTP](./security-time-synchronization/time-sync-ieee-1588-ptp.md) |
| ❌ | [Time Sync – IEEE 802.1AS](./security-time-synchronization/time-sync-ieee-802-1as.md) |
| ❌ | [Time Sync – NTP](./security-time-synchronization/time-sync-ntp.md) |
| ✅ | [Time Sync – OS Based Support](./security-time-synchronization/time-sync-os-based.md) |
| ❌ | [Time Sync – UA Based Support](./security-time-synchronization/time-sync-ua-based.md) |

#### User Token – Anonymous Client — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Security User Anonymous Client](./user-token-anonymous-client/security-user-anonymous-client.md) |

#### Minimum UA 2025 Client Facet — Required

| Status | Conformance Unit |
|--------|-----------------|
| ❌ | [Discovery Client Configure Endpoint](./minimum-ua-2025-client-facet/discovery-client-configure-endpoint.md) |
| ❌ | [Security Default ApplicationInstance Certificate](./minimum-ua-2025-client-facet/security-default-application-instance-certificate.md) |

#### Minimum UA 2025 Client Facet — Optional

| Status | Conformance Unit |
|--------|-----------------|
| ❌ | [Security ECC Policy](./minimum-ua-2025-client-facet/security-ecc-policy.md) |

#### Base Client Behaviour Facet — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Discovery Client Configure Endpoint](./base-client-behaviour-facet/discovery-client-configure-endpoint.md) |
| ✅ | [Security Administration](./base-client-behaviour-facet/security-administration.md) |
| ✅ | [Security Certificate Administration](./base-client-behaviour-facet/security-certificate-administration.md) |
| ✅ | [Base Info Client Remote Nodes](./base-client-behaviour-facet/base-info-client-remote-nodes.md) |
| ✅ | [Session Client Auto Reconnect](./base-client-behaviour-facet/session-client-auto-reconnect.md) |
| ✅ | [Subscription Client Multiple](./base-client-behaviour-facet/subscription-client-multiple.md) |
| ✅ | [Subscription Client Publish Multiple](./base-client-behaviour-facet/subscription-client-publish-multiple.md) |

#### Core 2022 Server Facet — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Address Space Atomicity](./core-2022-server-facet/address-space-atomicity.md) |
| ✅ | [Address Space Base](./core-2022-server-facet/address-space-base.md) |
| ✅ | [Address Space Full Array Only](./core-2022-server-facet/address-space-full-array-only.md) |
| ✅ | [Attribute Read](./core-2022-server-facet/attribute-read.md) |
| ✅ | [Base Info Core Structure 2](./core-2022-server-facet/base-info-core-structure-2.md) |
| ✅ | [Base Info Server Capabilities 2](./core-2022-server-facet/base-info-server-capabilities-2.md) |
| ✅ | [Discovery Find Servers Self](./core-2022-server-facet/discovery-find-servers-self.md) |
| ✅ | [Discovery Get Endpoints](./core-2022-server-facet/discovery-get-endpoints.md) |
| ✅ | [Documentation – Core Capacities](./core-2022-server-facet/documentation-core-capacities.md) |
| ✅ | [SecurityPolicy Support](./core-2022-server-facet/security-policy-support.md) |
| ✅ | [Session Base](./core-2022-server-facet/session-base.md) |
| ✅ | [Session General Service Behaviour](./core-2022-server-facet/session-general-service-behaviour.md) |
| ✅ | [View Basic 2](./core-2022-server-facet/view-basic-2.md) |
| ✅ | [View RegisterNodes](./core-2022-server-facet/view-register-nodes.md) |
| ✅ | [View TranslateBrowsePath](./core-2022-server-facet/view-translate-browse-path.md) |

#### Core 2022 Server Facet — Optional

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Address Space AddIn DefaultInstanceBrowsename](./core-2022-server-facet/address-space-addin-default-instance-browsename.md) |
| ✅ | [Address Space AddIn Reference](./core-2022-server-facet/address-space-addin-reference.md) |
| ✅ | [Address Space Interfaces](./core-2022-server-facet/address-space-interfaces.md) |
| ✅ | [Address Space NonVolatile and Constant](./core-2022-server-facet/address-space-non-volatile-and-constant.md) |
| ✅ | [Attribute Write Index](./core-2022-server-facet/attribute-write-index.md) |
| ✅ | [Attribute Write StatusCode & Timestamp](./core-2022-server-facet/attribute-write-statuscode-and-timestamp.md) |
| ✅ | [Attribute Write Values](./core-2022-server-facet/attribute-write-values.md) |
| ✅ | [Base Info Core Views Folder](./core-2022-server-facet/base-info-core-views-folder.md) |
| ✅ | [Base Info Currency](./core-2022-server-facet/base-info-currency.md) |
| ❌ | [Base Info Diagnostics](./core-2022-server-facet/base-info-diagnostics.md) |
| ✅ | [Base Info Engineering Units](./core-2022-server-facet/base-info-engineering-units.md) |
| ✅ | [Base Info Estimated Return Time](./core-2022-server-facet/base-info-estimated-return-time.md) |
| ✅ | [Base Info LocalTime](./core-2022-server-facet/base-info-local-time.md) |
| ✅ | [Base Info Locations Object](./core-2022-server-facet/base-info-locations-object.md) |
| ✅ | [Base Info Namespace Metadata](./core-2022-server-facet/base-info-namespace-metadata.md) |
| ✅ | [Base Info OptionSet](./core-2022-server-facet/base-info-option-set.md) |
| ✅ | [Base Info Selection List](./core-2022-server-facet/base-info-selection-list.md) |
| ✅ | [Base Info ValueAsText](./core-2022-server-facet/base-info-value-as-text.md) |
| ❌ | [Base Services Diagnostics](./core-2022-server-facet/base-services-diagnostics.md) |
| ❌ | [Security Administration](./core-2022-server-facet/security-administration.md) |
| ❌ | [Security Role Server Authorization](./core-2022-server-facet/security-role-server-authorization.md) |
| ✅ | [Session Change User](./core-2022-server-facet/session-change-user.md) |

#### User Token – Anonymous Server — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Security User Anonymous Server](./user-token-anonymous-server/security-user-anonymous-server.md) |

#### User Token – User Name Password Server — Required

| Status | Conformance Unit |
|--------|-----------------|
| ❌ | [Security Invalid user token](./user-token-user-name-password-server/security-invalid-user-token.md) |
| ❌ | [Security User Name Password 2](./user-token-user-name-password-server/security-user-name-password-2.md) |

#### User Token – User Name Password Server — Optional

| Status | Conformance Unit |
|--------|-----------------|
| ❌ | [Security User Token Unencrypted](./user-token-user-name-password-server/security-user-token-unencrypted.md) |

#### Embedded DataChange Subscription 2022 Server Facet — Required

| Status | Conformance Unit |
|--------|-----------------|
| ✅ | [Subscription Basic](./embedded-datachange-subscription-2022-server-facet/subscription-basic.md) |
| ✅ | [Subscription Publish Basic](./embedded-datachange-subscription-2022-server-facet/subscription-publish-basic.md) |
| ✅ | [Subscription PublishRequest Queue Overflow](./embedded-datachange-subscription-2022-server-facet/subscription-publish-request-queue-overflow.md) |
| ✅ | [Monitor Basic](./embedded-datachange-subscription-2022-server-facet/monitor-basic.md) |
| ✅ | [Monitor Items 2](./embedded-datachange-subscription-2022-server-facet/monitor-items-2.md) |
| ✅ | [Monitor Value Change V2](./embedded-datachange-subscription-2022-server-facet/monitor-value-change-v2.md) |
| ✅ | [Base Info Server Capabilities Subscriptions](./embedded-datachange-subscription-2022-server-facet/base-info-server-capabilities-subscriptions.md) |
| ✅ | [Base Info Server Capabilities MaxMonitoredItemsQueueSize](./embedded-datachange-subscription-2022-server-facet/base-info-server-capabilities-max-monitored-items-queue-size.md) |
| ✅ | [Base Info Fixed SamplingInterval](./embedded-datachange-subscription-2022-server-facet/base-info-fixed-sampling-interval.md) |
| ✅ | [Base Info SemanticChange Bit](./embedded-datachange-subscription-2022-server-facet/base-info-semantic-change-bit.md) |

## Specification References

| Part | Title | URL |
|------|-------|-----|
| OPC 10000-1 | Overview and Concepts | https://reference.opcfoundation.org/Core/Part1/v105/docs/ |
| OPC 10000-2 | Security Model | https://reference.opcfoundation.org/Core/Part2/v105/docs/ |
| OPC 10000-3 | Address Space Model | https://reference.opcfoundation.org/Core/Part3/v105/docs/ |
| OPC 10000-4 | Services | https://reference.opcfoundation.org/Core/Part4/v105/docs/ |
| OPC 10000-5 | Information Model | https://reference.opcfoundation.org/Core/Part5/v105/docs/ |
| OPC 10000-6 | Mappings | https://reference.opcfoundation.org/Core/Part6/v105/docs/ |
| OPC 10000-7 | Profiles | https://reference.opcfoundation.org/Core/Part7/v105/docs/ |

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented and tested |
| ⚠️ | Partially implemented |
| ❌ | Not yet implemented |
