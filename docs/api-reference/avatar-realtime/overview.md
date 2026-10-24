> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Start, inspect and release realtime avatar sessions in your LiveKit rooms.

REST reference for realtime avatar sessions. A session puts a Higgs Avatar participant into a LiveKit room you own. Your voice agent streams its speech audio to that participant, and the avatar publishes lip-synced video and that audio into the room until you release the session or it expires. For a guided walkthrough, see [Realtime sessions](https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md).

```text Base URL theme={null}
https://api.boson.ai
```

***

## Routes

| Route | Purpose |
| - | - |
| [`POST /v1/avatar/sessions`](https://docs.boson.ai/api-reference/avatar-realtime/create-a-session) | Start a session. Returns `201` with the session object once the avatar has joined the room. |
| [`GET /v1/avatar/sessions/{session_id}`](https://docs.boson.ai/api-reference/avatar-realtime/retrieve-a-session) | Current state of a session. |
| [`DELETE /v1/avatar/sessions/{session_id}`](https://docs.boson.ai/api-reference/avatar-realtime/release-a-session) | Release a session; the avatar leaves the room. |
| [`GET /v1/avatars`](https://docs.boson.ai/api-reference/avatar-realtime/list-avatars) | The avatars this API key can use (presets plus your own). |

The avatar's audio and video never pass through these routes: they flow inside your LiveKit room, between your agent, the avatar participant and your users. The routes only start, inspect and release the session.

**Authentication**

Every route takes `Authorization: Bearer <API_KEY>`, the same [Boson API key](https://docs.boson.ai/authentication.md) as the other APIs. Sessions belong to the key that created them; another key gets `404` for them. Only your server should call these routes, because the request carries a LiveKit token.

***

## Session lifecycle

| `status` | Meaning |
| - | - |
| `active` | The avatar is in the room and rendering. |
| `releasing` | A `DELETE` was accepted and the end is not confirmed yet. `GET` again. |
| `terminated` | The session has ended: released, `max_duration_seconds` reached, the room emptied, or ended by Boson for another reason. Ended sessions stay retrievable until a few minutes after `expires_at`, then `GET` returns `404`. |

Boson ends every session by itself, even if your `DELETE` never arrives: at `expires_at`, or when every other participant has left the room. Still, release sessions you no longer need: avatar capacity is limited, and a session you forgot keeps its slot until it expires.

Creation is **not idempotent**. If `POST /v1/avatar/sessions` times out, do not replay it blindly: a second avatar may join the room. Look for the avatar participant in the room first, and release any duplicate.

***

## LiveKit transport

The request's `transport` describes your room. You mint the avatar's access token with your own LiveKit API key and secret.

| Field | Requirement |
| - | - |
| `url` | Your LiveKit Cloud project URL, `wss://<project>.livekit.cloud`. |
| `room_name` | The room the avatar joins. |
| `participant_token` | Token for the avatar participant: identity = `participant_identity`, grants `roomJoin`, `canPublish` (camera and microphone sources), `canPublishData`; TTL longer than the session. The API does not inspect it: a token with the wrong identity or grants fails when the avatar joins the room. Never echoed back or logged. |
| `participant_identity` | The identity the avatar joins as. |
| `publisher_identity` | Your voice agent's identity. The avatar lip-syncs to the audio this participant sends it, so it must differ from `participant_identity`. |
| `audio_source` | `data_stream`: the LiveKit Agents avatar audio protocol. 16-bit PCM frames (24 kHz) travel over a LiveKit byte stream from `publisher_identity` to the avatar, as `DataStreamAudioOutput` in `livekit-agents` implements it, with its playback and clear-buffer RPCs. The avatar republishes the audio as its own track, in sync with the video. |

***

## Limits

| Limit | Value |
| - | - |
| `max_duration_seconds` | 1 to 14400 in the request; capped per account, 3600 s by default (`invalid_duration` above the cap). |
| `output` | Width and height 64 to 2048 px each; default 480x640. Not every size in that range is offered; one that is not is refused with `unsupported_output`. |
| Concurrent sessions | Bounded by shared avatar capacity. When every slot is in use, the create returns `429 capacity_exhausted` with `Retry-After`. |
| Rate limits | Per API key and model, like every other route; shared with `POST /v1/videos`, which uses the same model. See [Usage and limits](https://docs.boson.ai/account-billing/usage-and-limits.md). |

***

## Errors

Errors use the common [error body](https://docs.boson.ai/api-reference/errors.md); `type` is the stable category and `code` the cause. `429 capacity_exhausted` and `503 service_unavailable` carry a `Retry-After` header in seconds.

| Status | `code` | Meaning |
| - | - | - |
| `401` | `invalid_api_key` | Missing or invalid API key. |
| `400` | `missing_required_field`, `invalid_field_value` | Malformed body: a missing field, a value outside its bounds (`transport.url` not `wss://`, `max_duration_seconds` over 14400, an `output` side outside 64–2048), or an unknown field. |
| `403` | — | The key may not use the requested `model` (checked before the model is looked up). |
| `404` | `model_not_found` | Unknown `model`, or a model that does not serve realtime sessions. |
| `404` | `avatar_not_found` | Unknown `avatar_id`, or an avatar another key owns. |
| `404` | `session_not_found` | Unknown session, or a session another key created. |
| `422` | `invalid_livekit_url` | `transport.url` has no host or carries credentials, or its host is not an approved LiveKit server. LiveKit Cloud project URLs (`wss://<project>.livekit.cloud`) are approved; self-hosted servers are not. |
| `422` | `invalid_identity` | `participant_identity` equals `publisher_identity`. |
| `422` | `invalid_duration` | `max_duration_seconds` exceeds the account cap. |
| `422` | `unsupported_output` | The requested size is not supported. |
| `429` | `rate_limit_exceeded` | Too many requests (`type: rate_limit_error`). Retry with backoff. |
| `429` | `insufficient_quota` and others | Billing refusal (`type: insufficient_quota`); not transient. See [Common error types](https://docs.boson.ai/api-reference/errors.md#insufficient_quota-codes). |
| `429` | `capacity_exhausted` | Every avatar slot is in use, whatever `avatar_id` you ask for. Retry after `Retry-After`. |
| `503` | `service_unavailable` | Temporary outage on Boson's side. Retry after `Retry-After`. |
| `503` | `not_configured` | Realtime avatar is not enabled on this server. |


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.