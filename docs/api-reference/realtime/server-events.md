> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Server events

> Handle session state, input audio, streamed responses, tool calls, errors, and lifecycle events.

Events sent by the server as JSON text frames. Every server event carries a server-generated `event_id` (string) and a `type`.

## Session and conversation

### `session.created`

Sent in response to the first `session.update`. Contains the session id — read yours from `session.id`.

**session** `object`

The acknowledged session configuration, plus `id` (string) and `object: "realtime.session"`.

### `session.updated`

Acknowledges each `session.update` after the first.

**session** `object`

Same shape as in `session.created`.

### `conversation.item.added`

An item entered the conversation — user turns, assistant replies, tool calls and results, and client-created items alike.

**item** `object`

The [conversation item](#conversation-items).

**previous\_item\_id** `string | null`

Id of the item immediately before this one; `null` for the first item.

### `conversation.item.retrieved`

Answer to `conversation.item.retrieve`.

**item** `object`

The requested [conversation item](#conversation-items).

### `conversation.item.truncated`

Acknowledges `conversation.item.truncate`, echoing its fields.

**item\_id** `string`

Id of the truncated item.

**content\_index** `integer`

Index of the truncated content part.

**audio\_end\_ms** `integer`

Cut position in milliseconds (`0` for the text-only no-op).

### `conversation.item.deleted`

Acknowledges `conversation.item.delete`.

**item\_id** `string`

Id of the removed item.

### `conversation.context.summarized`

With `truncation: "auto"`, older conversation items were condensed into a summary to stay within the model's context window. The summarized items remain retrievable via `conversation.item.retrieve`. Extension; not part of the OpenAI Realtime API — clients built on OpenAI SDK event types should tolerate this unknown event type.

**summary** `string`

The summary text.

**summarized\_item\_ids** `array of string`

Ids of the items condensed into the summary.

**summary\_item\_id** `string`

Id of the new summary item.

**token\_count\_before** `integer`

Context token count before summarization.

**token\_count\_after** `integer`

Context token count after summarization.

## Input audio

### `input_audio_buffer.speech_started`

Server VAD detected the start of user speech. If the assistant is speaking, this is the barge-in signal — stop local playback.

**item\_id** `string`

Id of the user item this speech will be added to.

**audio\_start\_ms** `integer`

Position in the input audio stream, in milliseconds, where speech begins (includes `prefix_padding_ms`).

### `input_audio_buffer.speech_stopped`

Server VAD detected the end of user speech; a response follows automatically.

**item\_id** `string`

Id of the user item.

**audio\_end\_ms** `integer`

Position in the input audio stream, in milliseconds, where speech ends.

### `input_audio_buffer.committed`

The input buffer was committed as a user item — after a client `input_audio_buffer.commit`.

**item\_id** `string`

Id of the user item the audio was committed to.

**previous\_item\_id** `string | null`

Id of the item before it, or `null`.

### `input_audio_buffer.cleared`

Acknowledges `input_audio_buffer.clear`. No fields beyond `event_id` and `type`.

### `conversation.item.input_audio_transcription.completed`

Final transcript of a user audio turn. Only emitted when `audio.input.transcription.model` is configured (`higgs-stt-3.1`); when unset, no transcription events are emitted.

**item\_id** `string`

Id of the user item the transcript belongs to.

**content\_index** `integer`

Index of the audio content part that was transcribed.

**transcript** `string`

The transcript text.

## Response lifecycle

### `response.created`

Response generation started.

**response** `object`

The [response object](#response-object) with `status: "in_progress"`. Its `metadata` echoes the `metadata` from your `response.create`, letting you correlate this response with the request that triggered it (`null` when none was sent, e.g. VAD-triggered responses).

### `response.output_item.added`

An output item (assistant message or tool call) was added to the response.

**response\_id** `string`

Id of the response.

**output\_index** `integer`

Index of the item in the response output.

**item** `object`

The [conversation item](#conversation-items).

### `response.output_item.done`

An output item finished streaming. Fields as in `response.output_item.added`, with the completed item.

### `response.content_part.added`

A content part started streaming within an output item.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the output item.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the part within the item's content.

**part** `object`

Content part: `type` (`"text"` | `"audio"`), `audio` (string, base64, or null), `transcript` (string or null).

### `response.content_part.done`

A content part finished streaming. Fields as in `response.content_part.added`, with the completed part.

### `response.output_audio.delta`

A chunk of output audio, encoded in the configured `audio.output.format`.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the output item.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the audio content part.

**delta** `string`

Base64-encoded audio chunk.

### `response.output_audio.done`

The audio stream for a content part completed. Same fields as `response.output_audio.delta`, without `delta`.

### `response.output_audio_transcript.delta`

Streaming transcript of the audio the assistant is speaking.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the output item.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the content part.

**delta** `string`

Transcript text fragment.

### `response.output_audio_transcript.length`

A transcript fragment annotated with the duration of its corresponding audio — useful for aligning captions with playback. Extension; not part of the OpenAI schema.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the output item.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the content part.

**delta** `string`

Transcript text fragment.

**length\_ms** `integer`

Duration in milliseconds of the audio corresponding to `delta`.

### `response.output_audio_transcript.done`

The spoken transcript for a content part is complete.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the output item.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the content part.

**transcript** `string`

The full transcript of the spoken audio.

### `response.output_text.delta`

A fragment of streamed text output. Emitted instead of audio events when `output_modalities` is `["text"]`.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the output item.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the content part.

**delta** `string`

Text fragment.

### `response.output_text.done`

The text output for a content part is complete. Note this event carries no `item_id` — correlate via `response.output_item.done`.

**response\_id** `string`

Id of the response.

**output\_index** `integer`

Index of the item in the response output.

**content\_index** `integer`

Index of the content part.

**text** `string`

The full text output.

### `response.function_call_arguments.delta`

Streaming fragment of a tool call's arguments.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the `function_call` item.

**output\_index** `integer`

Index of the item in the response output.

**call\_id** `string`

Id of the tool call; echo it in `function_call_output`.

**delta** `string`

JSON arguments fragment.

### `response.function_call_arguments.done`

A tool call's arguments are complete. For a client-executed call, execute the function and return the result via `conversation.item.create` (`function_call_output`), then send `response.create`. A server-side tool's call (`executor: "server"` on the item, such as [`web_search`](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling#web-search)) needs no action.

**response\_id** `string`

Id of the response.

**item\_id** `string`

Id of the `function_call` item.

**output\_index** `integer`

Index of the item in the response output.

**name** `string`

Name of the function to call.

**call\_id** `string`

Id of the tool call; echo it in `function_call_output`.

**arguments** `string`

Complete JSON-encoded arguments.

### `response.done`

The response finished. Emitted exactly once per `response_id`. A response that ends in a tool call carries the completed `function_call` item in `response.output`.

**response** `object`

The [response object](#response-object). `status` is `completed` or `cancelled` (interrupted / `response.cancel`). The schema also defines `incomplete` and `failed`, but the server does not currently emit them.

## Session control and status

### `error`

Something went wrong. Billing refusals use `error.type: "insufficient_quota"` and precede WebSocket close code `4429`; check your balance and add credits in [workspace billing](https://www.boson.ai/workspace/billing/overview).

**error** `object`

`type` (string, error category), `code` (string or null), `message` (string, human-readable), `param` (string or null).

### `session.idle_timeout`

No user speech for the idle window (5 minutes). The session closes after this event.

**seconds\_idle** `integer`

Seconds without detected user speech.

### `session.max_duration_reached`

The session reached its server-enforced wall-clock cap. The session closes after this event.

**max\_duration\_sec** `integer`

The enforced maximum session duration, in seconds.

***

## Data types

### Conversation items

All items have `id`, `object: "realtime.item"`, and a `type`:

| Type | Fields | Notes |
| - | - | - |
| `message` (role `user`) | `content[]` of `input_text` / `input_audio`, `status` | Client-created messages carry `input_text` content; spoken turns carry audio with the transcript filled in as it completes. |
| `message` (role `assistant`) | `content[]` of `text` / `audio` (with `transcript`), `status` | |
| `function_call` | `call_id`, `name`, `arguments`, `status`, `executor` (`"client"` or `"server"`) | A tool call. `"client"`: your client executes it. `"server"`: a server-side tool such as [`web_search`](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling#web-search) that the server executes — don't return a result for it. |
| `function_call_output` | `call_id`, `output`, `status` | A tool's result: sent by the client for a `"client"` call, added by the server for a `"server"` call. |

### Response object

```json theme={null}
{
  "id": "resp_...",
  "object": "realtime.response",
  "status": "completed",
  "status_details": null,
  "output": [],
  "usage": null,
  "metadata": null
}
```

* `status` is `in_progress` (on `response.created`), then `completed` or `cancelled` (on `response.done`).
* `status_details` is defined in the schema (`{"type": "cancelled", "reason": "turn_detected" | "client_cancelled"}`, `{"type": "incomplete", "reason": "max_output_tokens" | "content_filter"}`, `{"type": "failed", "error": {"code", "message"}}`) but is currently always sent as `null`.
* `usage` (`{"total_tokens", "input_tokens", "output_tokens"}`) is currently always sent as `null`.
* `metadata` is echoed on `response.created` only; `response.done` carries `metadata: null`.

## Related

> **[Client events](https://docs.boson.ai/api-reference/realtime/client-events.md)**
>
> The events you send that trigger these.

> **[Audio and voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices.md)**
>
> Decode `response.output_audio.delta` in the format you configured.

> **[Turn detection and interruptions](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions.md)**
>
> Handling `speech_started` as the barge-in signal.

> **[Tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md)**
>
> Acting on `response.function_call_arguments.done`.

***


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.