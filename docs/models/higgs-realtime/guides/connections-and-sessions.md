> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Connections and sessions

> Connect over WebSocket, authenticate safely, configure a session, and choose Realtime and transcription models.

## Connection and session

**WebSocket endpoint:**

```
wss://api.boson.ai/v1/realtime
```

The server accepts the optional `realtime` WebSocket subprotocol.

### Session configuration

Configure the session with `session.update` (field paths relative to `session`):

| Parameter | Description |
| - | - |
| `model` | The realtime model for the session: `higgs-realtime`. Optional when the connection URL carries `?model=`; an explicit value here overrides the URL. One of the two must be set. See [Model Selection](#model-selection). |
| `instructions` | System prompt for agent behavior. |
| `audio.output.voice` | `"default"`, a named preset, or a custom `voice_<id>`. See [Voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices.md#voices). |
| `audio.input.turn_detection` | `{"type": "server_vad"}` for automatic turn taking, `{"type": "semantic_vad"}` for smarter end-of-turn judgment, or `null` for manual commit. See [Turn detection and interruptions](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions.md). |
| `audio.input.transcription` | Enable input transcription: set `model` to `higgs-stt-3.1` (with an optional `language` hint) to receive `conversation.item.input_audio_transcription.completed` events for user audio. When unset, no transcription events are emitted. See [Model Selection](#model-selection). |
| `audio.input.noise_reduction` | `{"type": "near_field"}` or `{"type": "far_field"}` to denoise input audio before the model hears it; `null` disables. |
| `output_modalities` | Exactly `["audio"]` (default, spoken output) or `["text"]` (stream `response.output_text.*` instead of audio). Mixed or empty lists are rejected. |
| `tools` | Array of `function` tools (JSON-schema parameters). See [Tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md). |
| `tool_choice` | `"auto"` (default), `"none"`, `"required"`, or `{"type": "function", "name": ...}`. |
| `temperature` | Sampling temperature (default `0.3`). |
| `max_output_tokens` | Per-response cap; integer or `"inf"` (default). Ints are clamped to 4096. |
| `truncation` | `"auto"` (default, smart context summarization) or `"disabled"`. See [Context management](https://docs.boson.ai/models/higgs-realtime/migrate-an-existing-integration.md#context-management). |

## Authentication

Authentication supports two methods:

* **API key** (server-side): pass an `Authorization: Bearer <API_KEY>` header when opening the WebSocket.
* **Ephemeral key** (client-side, recommended for browsers): mint a short-lived key server-side via `POST /v1/realtime/client_secrets`, then pass it from the browser in the WebSocket subprotocol list as `bai-client-secret.<EPHEMERAL_KEY>`. Ephemeral keys start with `bai-eph-`.

```javascript theme={null}
const ws = new WebSocket("wss://api.boson.ai/v1/realtime", [
  "realtime",
  `bai-client-secret.${ephemeralKey}`,
]);
```

### Minting an ephemeral key

Ephemeral keys let browser and mobile clients connect directly without ever seeing your real API key. From your backend, call `POST /v1/realtime/client_secrets` with your API key. The body is optional — `expires_after.seconds` sets the key's TTL (10–7200 seconds, default 600):

```bash theme={null}
curl -X POST https://api.boson.ai/v1/realtime/client_secrets \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expires_after": {"seconds": 300}}'
```

Response:

```json theme={null}
{
  "object": "realtime.client_secret",
  "value": "bai-eph-<hash>",
  "expires_at": 1712345678,
  "session": { "id": "sess_ab12cd34", "object": "realtime.session" }
}
```

Hand the `value` to your client, which uses it in the `bai-client-secret.<value>` subprotocol as shown above. The key expires at `expires_at` (Unix seconds) — mint a fresh one per connection. If the key is invalid or expired, the WebSocket closes with code `3000`.

## Model selection

| Model | Role | Description |
| - | - | - |
| `higgs-realtime` | Session model | End-to-end speech-to-speech model. Consumes and produces audio directly, with built-in turn detection, barge-in handling, and tool calling. |
| `higgs-stt-3.1` | Input transcription (optional) | Speech-to-text model for transcribing user audio. |

### Session model

`higgs-realtime` is currently the only supported session model. Set it with the `?model=` query parameter when connecting (`wss://api.boson.ai/v1/realtime?model=higgs-realtime`), or in `session.update` (which overrides the URL):

```json theme={null}
{
  "type": "session.update",
  "session": { "model": "higgs-realtime" }
}
```

### Input transcription model

The session works entirely in audio — you do not need a transcription model to converse. Optionally, set `audio.input.transcription.model` to `higgs-stt-3.1` to receive text transcripts of the user's audio as `conversation.item.input_audio_transcription.completed` events (useful for captions, logging, or moderation):

```json theme={null}
{
  "type": "session.update",
  "session": {
    "model": "higgs-realtime",
    "audio": {
      "input": {
        "transcription": { "model": "higgs-stt-3.1" }
      }
    }
  }
}
```

Transcription is billed as usage of the specified model. When `transcription.model` is unset, no transcription events are emitted and no transcription charges apply.

An optional `transcription.language` hint biases the transcript toward a language — pass an ISO-639-1 code (`"ja"`, `"ko"`); unrecognized values are ignored. This is a transcription hint only, not a conversation-language setting: the model detects the spoken language automatically and replies in kind, and after the first reply the transcription language follows the conversation automatically.

## WebSocket events

Communication uses JSON-encoded events. Key event types:

**Client → Server:**

* [`session.update`](https://docs.boson.ai/api-reference/realtime/client-events#session-update) – Configure the session (model, voice, instructions, audio formats, tools, turn detection)
* [`input_audio_buffer.append`](https://docs.boson.ai/api-reference/realtime/client-events#input_audio_buffer-append) – Stream base64 audio chunks (max \~1 MiB base64 per append, ≈15 s of 24 kHz PCM)
* [`input_audio_buffer.commit`](https://docs.boson.ai/api-reference/realtime/client-events#input_audio_buffer-commit) / [`input_audio_buffer.clear`](https://docs.boson.ai/api-reference/realtime/client-events#input_audio_buffer-clear) – Manual turn control
* [`conversation.item.create`](https://docs.boson.ai/api-reference/realtime/client-events#conversation-item-create) – Inject user or assistant text messages, or function-call results
* [`response.create`](https://docs.boson.ai/api-reference/realtime/client-events#response-create) – Request a model response
* [`response.cancel`](https://docs.boson.ai/api-reference/realtime/client-events#response-cancel) – Cancel an in-flight response

**Server → Client:**

* [`session.created`](https://docs.boson.ai/api-reference/realtime/server-events#session-created) / [`session.updated`](https://docs.boson.ai/api-reference/realtime/server-events#session-updated) – Session initialization and config acks
* [`input_audio_buffer.speech_started`](https://docs.boson.ai/api-reference/realtime/server-events#input_audio_buffer-speech_started) / [`speech_stopped`](https://docs.boson.ai/api-reference/realtime/server-events#input_audio_buffer-speech_stopped) – Server VAD events
* [`response.output_audio.delta`](https://docs.boson.ai/api-reference/realtime/server-events#response-output_audio-delta) – Streaming audio chunks (base64)
* [`response.output_audio_transcript.delta`](https://docs.boson.ai/api-reference/realtime/server-events#response-output_audio_transcript-delta) – Streaming transcript of the spoken response
* [`response.function_call_arguments.done`](https://docs.boson.ai/api-reference/realtime/server-events#response-function_call_arguments-done) – Tool invocation ready
* [`response.done`](https://docs.boson.ai/api-reference/realtime/server-events#response-done) – Turn completion
* [`error`](https://docs.boson.ai/api-reference/realtime/server-events#error) – Session errors

See the complete event catalog and payload schemas in the Realtime API reference: [client events](https://docs.boson.ai/api-reference/realtime/client-events.md) and [server events](https://docs.boson.ai/api-reference/realtime/server-events.md).

> **[Client events](https://docs.boson.ai/api-reference/realtime/client-events.md)**
>
> Every event you send: fields, types, and the full session configuration object.

> **[Server events](https://docs.boson.ai/api-reference/realtime/server-events.md)**
>
> Every event you receive: session, audio, response lifecycle, tool calls, and errors.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.