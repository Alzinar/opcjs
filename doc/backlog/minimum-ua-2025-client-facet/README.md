# Minimum UA 2025 Client Facet

**Specification**: OPC 10000-7 §6.x (Profiles), version 1.05  
**Profile URI**: `http://opcfoundation.org/UA-Profile/Client/MinimumFacet2025`  
**Category**: Client  

## Overview

The Minimum UA 2025 Client Facet defines the minimum functionalities required for OPC UA Clients to establish and maintain Sessions through the OPC UA TCP binary protocol.
It supersedes the Minimum UA Client Facet, making support for ECC security policies optional.

## Required Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [discovery-client-configure-endpoint.md](./discovery-client-configure-endpoint.md) | Discovery Client Configure Endpoint |
| ✅ | [security-default-application-instance-certificate.md](./security-default-application-instance-certificate.md) | Security Default ApplicationInstance Certificate |

## Optional Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ❌ | [security-ecc-policy.md](./security-ecc-policy.md) | Security ECC Policy |
