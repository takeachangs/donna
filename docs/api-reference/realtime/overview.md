> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Connect to Higgs Realtime and navigate the REST and WebSocket protocol reference.

REST and WebSocket reference for the realtime voice API. All routes are prefixed with `/v1/realtime`. For a guided walkthrough, see [Speech to Speech](https://docs.boson.ai/models/higgs-realtime/overview.md).

***

## WebSocket connection

```text WebSocket endpoint theme={null}
wss://api.boson.ai/v1/realtime
```

Establishes a realtime voice session. The connection upgrades from HTTP GET (status 101) and then exchanges JSON events for session configuration, audio streaming, and responses.

**Query parameters**

| Parameter | Purpose |
| - | - |
| `model` | Optional; the session model (`higgs-realtime`). Used when `session.update` omits `session.model`; an explicit `session.model` overrides it. |

**Subprotocols**

| Value | Purpose |
| - | - |
| `realtime` | Optional; echoed back as the negotiated subprotocol if offered. |
| `bai-client-secret.<key>` | Client-side auth with an ephemeral key. |

**Authentication**

Either an `Authorization: Bearer <API_KEY>` header (server-side), or an ephemeral key (`bai-eph-…`) passed via subprotocol (client-side). Ephemeral keys are minted with [`POST /v1/realtime/client_secrets`](https://docs.boson.ai/api-reference/realtime/client-secrets).

**WebSocket close codes**

| Code | Meaning |
| - | - |
| `1000` | Normal closure — including session-limit closes (idle timeout, max session duration), which are preceded by their server event and carry the reason in the close frame. |
| `1013` | Max concurrency exceeded — retry later. |
| `3000` | Invalid API key or invalid/expired ephemeral key. |
| `4429` | Billing entitlement refused (quota exhausted, spending cap, contract ended). Always preceded by an `error` event carrying the upstream message. Check your balance and add credits in [workspace billing](https://www.boson.ai/workspace/billing/overview). |

***

## WebRTC

WebRTC transport support is in progress. WebSocket is the supported transport today.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.