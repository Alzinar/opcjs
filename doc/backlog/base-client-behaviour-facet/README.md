# Base Client Behaviour Facet

**Specification**: OPC 10000-7 §6.x (Profiles), version 1.05  
**Profile URI**: `http://opcfoundation.org/UA-Profile/Client/Behaviour`  
**Category**: Client  

## Overview

The Base Client Behaviour Facet defines best-practice behaviours that clients should follow for best use by operators and administrators.  
These include: allowing endpoint configuration without discovery; security administration; automatic reconnection; and efficient subscription use.  
These behaviours can only be tested in a TestLab — they are best practice guidelines.

## Required Conformance Units

| Status | Document | Conformance Unit |
|--------|----------|-----------------|
| ✅ | [discovery-client-configure-endpoint.md](./discovery-client-configure-endpoint.md) | Discovery Client Configure Endpoint |
| ✅ | [security-administration.md](./security-administration.md) | Security Administration |
| ✅ | [security-certificate-administration.md](./security-certificate-administration.md) | Security Certificate Administration |
| ✅ | [base-info-client-remote-nodes.md](./base-info-client-remote-nodes.md) | Base Info Client Remote Nodes |
| ✅ | [session-client-auto-reconnect.md](./session-client-auto-reconnect.md) | Session Client Auto Reconnect |
| ✅ | [subscription-client-multiple.md](./subscription-client-multiple.md) | Subscription Client Multiple |
| ✅ | [subscription-client-publish-multiple.md](./subscription-client-publish-multiple.md) | Subscription Client Publish Multiple |
