> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Turn detection and interruptions

> Configure automatic or manual turns and keep the conversation aligned during barge-in.

## Turn detection

Set `audio.input.turn_detection` to `{"type": "server_vad"}` for automatic turn taking, `{"type": "semantic_vad"}` for smarter end-of-turn judgment, or `null` for manual `input_audio_buffer.commit` control.

With server VAD active, the model automatically responds when you stop speaking, and user speech during playback interrupts the assistant (barge-in).

`server_vad` parameters:

| Parameter | Default | Description |
| - | - | - |
| `threshold` | `0.85` | VAD speech-probability threshold (0.0–1.0). Higher values need clearer, louder speech to start a turn and ignore more background noise; lower it for quiet or far-field input |
| `prefix_padding_ms` | `300` | Audio included before detected speech |
| `silence_duration_ms` | `500` | Silence needed to end a turn |
| `min_speech_duration` | `0.125` | Minimum speech (seconds) to start a segment |

`semantic_vad` extends `server_vad` with a semantic judgment of whether the user has truly finished speaking, reducing premature cut-offs during natural pauses.

## Interruptions (barge-in)

User speech during assistant playback cancels the in-flight response: audio output stops, the assistant's conversation item is truncated at the interruption point, and a new user turn begins immediately. Clients can also truncate played-back items explicitly with [`conversation.item.truncate`](https://docs.boson.ai/api-reference/realtime/client-events#conversation-item-truncate) (by `audio_end_ms`) so the stored transcript matches what the user actually heard.

> **[Barge-in signal reference](https://docs.boson.ai/api-reference/realtime/server-events.md#input_audio_buffer-speech_started)**
>
> `input_audio_buffer.speech_started` is the event to listen for — stop local playback when it arrives.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.