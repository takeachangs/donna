> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Client events

> Configure a Realtime session, provide input, manage conversation items, and control responses.

Events are sent as JSON text frames over the WebSocket. Every client event has a required `type` and may carry an optional `event_id` (string; an identifier is generated when omitted). Unknown or malformed events produce an `error` event.

## `session.update`

Create or update the session configuration. The first `session.update` starts the session and is acknowledged with `session.created`; every later one is acknowledged with `session.updated`. An invalid configuration produces an `error` and the session is closed.

**type** `string` *required*

Always `session.update`.

**event\_id** `string`

Client-chosen event identifier.

**session** `object` *required*

The [session configuration object](#session-configuration-object). The model comes from `session.model` or, when it is omitted, from the connection URL's `?model=` query parameter; the first `session.update` fails if neither is set.

## `input_audio_buffer.append`

Append an audio chunk to the input buffer. The audio must be encoded in the configured `audio.input.format`. With server VAD, buffered audio is consumed automatically as speech is detected; with `turn_detection: null`, audio accumulates until `input_audio_buffer.commit`. The server does not acknowledge each append.

**type** `string` *required*

Always `input_audio_buffer.append`.

**event\_id** `string`

Client-chosen event identifier.

**audio** `string` *required*

Base64-encoded audio in the session's input format. Maximum 1,048,576 base64 bytes per event (≈15 s of 24 kHz PCM16); larger chunks produce an `error`.

## `input_audio_buffer.commit`

Commit the buffered audio as a user turn (manual turn detection, i.e. `turn_detection: null`). The server emits `input_audio_buffer.committed`, transcribes the audio, and adds the user item to the conversation (`conversation.item.added`). Committing does not generate a response — send `response.create`. Rejected with an `error` (`type: "voice_output_task_ongoing"`) while a response is being generated.

**type** `string` *required*

Always `input_audio_buffer.commit`.

**event\_id** `string`

Client-chosen event identifier.

## `input_audio_buffer.clear`

Discard all uncommitted audio in the input buffer. Acknowledged with `input_audio_buffer.cleared`.

**type** `string` *required*

Always `input_audio_buffer.clear`.

**event\_id** `string`

Client-chosen event identifier.

## `conversation.item.create`

Add an item to the conversation — a text message, or a `function_call_output` returning a tool result. Acknowledged with `conversation.item.added`. Creating an item never triggers a response by itself; send `response.create` when you want one.

**type** `string` *required*

Always `conversation.item.create`.

**event\_id** `string`

Client-chosen event identifier.

**previous\_item\_id** `string | null`

Id of the item to insert after. Omitted or `null` appends at the end of the conversation. An unknown id produces an `error` (`type: "invalid_previous_item_id"`).

**item** `object` *required*

The item to add. See supported item types below.

Supported `item` types:

| `item.type` | Fields | Description |
| - | - | - |
| `message` | `role` (`"user"` \| `"assistant"`), `content` (array), `id` (string, optional) | A conversation message. `content` must be text — `[{"type": "input_text", "text": "..."}]` for `user` messages, `[{"type": "text", "text": "..."}]` for `assistant` messages; items with non-text content are skipped. |
| `function_call` | `call_id`, `name`, `arguments` (strings), `id` (string, optional) | A past tool call — useful when rebuilding conversation history. |
| `function_call_output` | `call_id` (string), `output` (string), `id` (string, optional) | The result of a tool call your client executed. `call_id` must echo the `call_id` from the `function_call` item. |

A client-supplied `item.id` is preserved so the item can be addressed later (retrieve / truncate / delete); an id that already exists produces an `error` (`type: "conversation_item_duplicate_id"`). When omitted, the server generates one.

## `conversation.item.retrieve`

Fetch the server's full copy of a conversation item by id — typically to inspect a user audio item (its audio content and transcript) as captured server-side, or to fetch an older item condensed away by `conversation.context.summarized`. Answered with `conversation.item.retrieved`, or an `error` (`type: "conversation_item_not_found"`).

**type** `string` *required*

Always `conversation.item.retrieve`.

**event\_id** `string`

Client-chosen event identifier.

**item\_id** `string` *required*

Id of the item to fetch.

## `conversation.item.truncate`

Truncate a completed assistant item to what the user actually heard — use it when your client stopped playback early, so the stored transcript matches the audio played. Acknowledged with `conversation.item.truncated`. In text-only sessions (`output_modalities: ["text"]`) this is a no-op acknowledged with `audio_end_ms: 0`.

**type** `string` *required*

Always `conversation.item.truncate`.

**event\_id** `string`

Client-chosen event identifier.

**item\_id** `string` *required*

Id of the assistant item to truncate.

**content\_index** `integer` *required*

Index of the content part to truncate.

**audio\_end\_ms** `integer` *required*

Playback position, in milliseconds from the start of the item's audio, at which to cut.

## `conversation.item.delete`

Remove an item from the conversation. Acknowledged with `conversation.item.deleted`.

**type** `string` *required*

Always `conversation.item.delete`.

**event\_id** `string`

Client-chosen event identifier.

**item\_id** `string` *required*

Id of the item to remove.

## `response.create`

Request a model response. Without a `response` body, the response is generated from the current conversation and session configuration. With server VAD, any in-flight response is interrupted first; with `turn_detection: null`, the request is rejected with an `error` (`type: "voice_output_task_ongoing"`) while a response is active.

**type** `string` *required*

Always `response.create`.

**event\_id** `string`

Client-chosen event identifier.

**response** `object`

Per-response overrides.

**response fields**

**instructions** `string`

System prompt for this response.

**input** `array`

Message items to respond to: `[{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "..."}]}]`. The messages are also appended to the conversation.

**temperature** `number`

Sampling temperature for this response only.

**max\_output\_tokens** `integer | "inf"`

Output token cap for this response only.

**metadata** `object`

Attached to the `response.created` event's response object (`response.done` does not echo it).

## `response.cancel`

Cancel the in-flight response. The cancelled response finishes with `response.done` (`status: "cancelled"`).

**type** `string` *required*

Always `response.cancel`.

**event\_id** `string`

Client-chosen event identifier.

**response\_id** `string`

When set, must match the active response's id, else an `error` (`code: "response_id_mismatch"`). When no response is active, an `error` (`code: "response_not_active"`).

## Session configuration object

Passed as `session` in `session.update`:

```json theme={null}
{
  "type": "realtime",
  "model": "higgs-realtime",
  "instructions": "You are a helpful AI assistant",
  "output_modalities": ["audio"],
  "audio": {
    "input": {
      "format": { "type": "audio/pcm", "rate": 24000 },
      "noise_reduction": { "type": "near_field" },
      "transcription": { "model": "higgs-stt-3.1", "language": null },
      "turn_detection": {
        "type": "server_vad",
        "threshold": 0.85,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 500,
        "min_speech_duration": 0.125
      }
    },
    "output": {
      "format": { "type": "audio/pcm", "rate": 24000 },
      "voice": "default"
    }
  },
  "tools": [],
  "tool_choice": "auto",
  "temperature": 0.3,
  "max_output_tokens": "inf",
  "truncation": "auto"
}
```

Constraints:

* `model` is optional when the connection URL carries `?model=` (an explicit `session.model` overrides the URL); the first `session.update` fails if neither is set. Use `higgs-realtime`.
* `output_modalities` must be exactly `["audio"]` or `["text"]`.
* `max_output_tokens` integers are clamped to `4096`; `"inf"` is unbounded.
* `audio.*.format.type` is one of `audio/pcm` (`rate`: 8000 | 16000 | 24000 | 48000), `audio/pcmu`, `audio/opus` (`frame_size_ms`: 2.5 | 5 | 10 | 20 | 40 | 60).
* `turn_detection.type` is `server_vad` or `semantic_vad`.
* A non-`"default"` `voice` is validated against the voices API at update time; an unknown voice fails the `session.update`.
* `transcription.model` enables input transcription: set it to `higgs-stt-3.1` to receive `conversation.item.input_audio_transcription.completed` events; when unset, no transcription events are emitted. `language` is an optional ISO-639-1 hint.
* `tools[]` entries: `{ "type": "function", "name", "description", "parameters" }`, or the server-side `{ "type": "web_search" }` with optional `allowed_domains` / `excluded_domains` (max 5 each, mutually exclusive) and `location: { "country": "<ISO 3166-1 alpha-2>" }`. See [Web search](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md#web-search).

## Related

> **[Server events](https://docs.boson.ai/api-reference/realtime/server-events.md)**
>
> The events the server sends back in response to these.

> **[Connections and sessions](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions.md)**
>
> How to connect, authenticate, and choose session settings.

> **[Turn detection](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions.md)**
>
> When to commit audio yourself versus letting server VAD do it.

> **[Tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md)**
>
> Declaring tools and returning results with `function_call_output`.

***


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.