> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Migrate an existing integration

> Move an OpenAI Realtime integration to Higgs Realtime and review the protocol compatibility differences.

If you have an existing application built on the OpenAI Realtime API, switching requires only a few changes: update the WebSocket URL, swap your API key, and select the model in `session.update`.

**1. Update the base URL and API key**

**OpenAI SDK**

If you are using the official OpenAI SDK, point the client at the Boson endpoint and supply your Boson API key:

```python theme={null}
import asyncio
import os
from openai import AsyncOpenAI

# Before (OpenAI)
# client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

# After (Boson AI)
client = AsyncOpenAI(
    api_key=os.environ["BOSON_API_KEY"],
    base_url="https://api.boson.ai/v1",
)

async def main():
    async with client.realtime.connect(model="higgs-realtime") as conn:
        await conn.session.update(session={
            "model": "higgs-realtime",
            "instructions": "You are a helpful assistant.",
            # ... rest of your session config
        })
        # ... rest of your application code

asyncio.run(main())
```

**Raw WebSocket**

If you connect directly via WebSocket, change the URL and `Authorization` header:

```python theme={null}
import os
import websockets

# Before (OpenAI)
# url = "wss://api.openai.com/v1/realtime?model=gpt-realtime"
# headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}

# After (Boson AI)
url = "wss://api.boson.ai/v1/realtime?model=higgs-realtime"
headers = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}

async with websockets.connect(url, additional_headers=headers) as ws:
    # Most event handling can be reused after reviewing the compatibility differences below
    ...
```

**2. Choose a model**

Use `higgs-realtime` in place of `gpt-realtime`. As on OpenAI, the `?model=` query parameter in the connection URL selects the model; you can also set (or override) it in `session.update`:

```python theme={null}
await ws.send(json.dumps({
    "type": "session.update",
    "session": {
        "model": "higgs-realtime",
        # ... the rest of your existing session config
    }
}))
```

If neither the URL nor the first `session.update` names a model, the update fails with an error.

**3. Review your session config and prompts**

* Check the [compatibility notes](#openai-realtime-api-compatibility) below: a few OpenAI session fields are inert or rejected here, and `output_modalities` must be exactly one modality.
* Revisit your system prompt: instructions written to patch quirks of another model usually aren't needed — start from a short, direct prompt and add back only what proves necessary.

## OpenAI Realtime API Compatibility

The event protocol is compatible with OpenAI's GA Realtime API: most OpenAI Realtime clients work by changing the endpoint to `wss://api.boson.ai/v1/realtime` and supplying a Boson API key. The differences are listed below, roughly in the order a migrating client will hit them.

> **Connection and lifecycle**
>
> * **WebSocket only.** OpenAI's WebRTC and SIP transports are not available — no `/v1/realtime/calls` endpoints, no `output_audio_buffer.*` events, no DTMF events. WebRTC support is in progress.
> * **Model selection works as on OpenAI.** The `?model=` query parameter selects the model; `session.model` in a `session.update` overrides it. If neither is set, the first `session.update` fails. Use `higgs-realtime` in place of `gpt-realtime`.
> * **`session.created` acknowledges your first `session.update`.** OpenAI emits `session.created` immediately on connect; here the server sends nothing until you send `session.update`. Don't wait for `session.created` before configuring the session. `conversation.created` is never emitted.
> * **Realtime sessions only.** `session.type` is always `"realtime"`; OpenAI's transcription-only sessions (`"type": "transcription"`) are not supported.
> * **Ephemeral keys:** `POST /v1/realtime/client_secrets` works the same way (`expires_after.seconds`, 10–7200, default 600), but a `session` object in the request body is ignored — configure the session over the WebSocket after connecting. Keys are prefixed `bai-eph-` rather than `ek_`.

> **Session configuration**
>
> * `output_modalities` must be exactly one of `["audio"]` or `["text"]` — mixed output is not supported.
> * **Audio formats:** `audio/pcm` accepts `rate` 8000 / 16000 / 24000 / 48000 (OpenAI: 24000 only), and `audio/opus` is available as an extension. `audio/pcmu` works as on OpenAI; `audio/pcma` (G.711 A-law) is not supported.
> * **Voices:** OpenAI voice names (`alloy`, `marin`, `cedar`, …) don't exist here — use `"default"`, a Boson AI preset, or a custom `voice_<id>` (see [Voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices.md#voices)). Non-default voices are validated at `session.update` time, so an OpenAI voice name fails the update.
> * **Input transcription:** set `transcription.model` to `higgs-stt-3.1`; OpenAI transcription models are not available. `language` works as on OpenAI; OpenAI's `prompt`, `keywords`, `languages`, and `delay` transcription options are ignored.
> * **Tools:** `function` tools, plus the server-side [`web_search`](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling#web-search) tool (`{"type": "web_search"}`, an extension — OpenAI Realtime has no built-in search). MCP tools (`"type": "mcp"`), tool approvals, and the `mcp_*` events are not supported.
> * **`temperature`** is accepted at the session level (default `0.3`) — an extension over OpenAI's GA schema.
> * **Turn detection:** `server_vad` and `semantic_vad` both exist, with differences: the `server_vad` threshold defaults to `0.85` (OpenAI: `0.5`), and `turn_detection.min_speech_duration` (minimum speech length in seconds before a segment starts, default `0.125`) is an extension. `create_response`, `interrupt_response`, and `eagerness` are accepted but have no effect — a response is always generated on end of turn, and barge-in always interrupts. `idle_timeout_ms` is rejected with an error if set.
> * **Rejected session fields** (fail the `session.update` if set): `include`, `prompt`, `tracing`.
> * **`truncation`** supports the `"auto"`/`"disabled"` string forms only (no `retention_ratio` object), and the mechanism differs — see [Context management](#context-management) below.

> **Events**
>
> * `input_audio_buffer.append` accepts at most 1 MiB of base64 audio per event (OpenAI: 15 MiB) — stream microphone audio in small chunks.
> * `conversation.item.create` supports text content only: `input_audio` and `input_image` message contents are skipped, and `system`-role messages are rejected. User messages use `input_text` content and assistant messages use `text` content (OpenAI's `output_text` type is not recognized). `function_call` and `function_call_output` items work as on OpenAI.
> * Input transcription arrives only as `conversation.item.input_audio_transcription.completed` — the `.delta`, `.failed`, and `.segment` (diarization) events are never emitted.
> * Also never emitted: `conversation.item.done`, `rate_limits.updated`, and `input_audio_buffer.timeout_triggered`. Don't gate client logic on receiving them.
> * Extra event types not in OpenAI's schema: `response.output_audio_transcript.length`, `conversation.context.summarized`, `session.idle_timeout`, and `session.max_duration_reached`. Make sure your client tolerates unknown event types rather than failing on them.

> **Responses**
>
> * `response.done` reports `status` `"completed"` or `"cancelled"` only, and its `usage` and `status_details` fields are currently always `null` (OpenAI populates per-response token usage). Response `metadata` is echoed on `response.created` only, not on `response.done`.

### Context management

With `truncation: "auto"` (default), long conversations are summarized in the background before they exceed the model's context window: older messages are condensed into a summary item (originals stay retrievable) and the server emits `conversation.context.summarized` with the affected `summarized_item_ids`. Set `truncation: "disabled"` to opt out. This differs from OpenAI's Realtime API, which drops old messages instead of summarizing them — and note that `conversation.context.summarized` is not an OpenAI event type, so make sure your client tolerates it rather than failing on unknown events (the official OpenAI SDK may not surface or parse it).

### Session limits

Session limits are enforced server-side and cannot be changed via `session.update`:

* **Max session duration:** the server sends `session.max_duration_reached` (carrying `max_duration_sec`) and closes when a session reaches its wall-clock cap.
* **Idle timeout:** after 5 minutes without detected user speech, the server sends `session.idle_timeout` (carrying `seconds_idle`) and closes.
* **Quota refusals:** if the account's billing entitlement is refused mid-session, the server sends an `error` event with the upstream message (`type: "insufficient_quota"`) and closes the WebSocket with code `4429`. Check your balance and add credits in [workspace billing](https://www.boson.ai/workspace/billing/overview).

### WebRTC

WebRTC transport support is in progress. WebSocket is the supported transport today.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.