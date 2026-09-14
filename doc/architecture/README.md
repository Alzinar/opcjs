# Architecture Documentation

This directory explains **how** the OPC UA client/server implementation works internally — as
opposed to [`doc/backlog/`](../backlog/README.md), which tracks **what** OPC UA conformance units
are implemented.

The goal is to make it easier for new contributors to understand the core implementation concepts
without having to reverse-engineer them from the source code.

## Topics

| Document | Covers |
|----------|--------|
| [connection-and-reconnection.md](./connection-and-reconnection.md) | How `Client.connect()` establishes a WebSocket/TCP/SecureChannel/Session pipeline, how keep-alive works, and how the client automatically recovers from dropped channels, expired sessions, and server shutdown |

More topics (subscriptions/publish loop, encoding pipeline, security, server-side architecture) will
be added over time.
