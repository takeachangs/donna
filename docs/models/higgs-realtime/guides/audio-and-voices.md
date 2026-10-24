> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Audio and voices

> Choose a Realtime voice, audio codec, and sample rate.

## Voices

Select the assistant's voice with `audio.output.voice`:

* `"default"` – the built-in preset, always available.
* A named preset voice from the [Text-to-Speech API](https://docs.boson.ai/models/higgs-tts/voices.md#preset-voices).
* A custom voice `voice_<id>`, created via the voices API (`POST /v1/audio/voices`). See [Custom Voices](https://docs.boson.ai/models/higgs-tts/voices.md#custom-voices) for more details.

Any non-`"default"` voice is validated when you send [`session.update`](https://docs.boson.ai/api-reference/realtime/client-events#session-update); an unknown or inaccessible voice fails the update. To adjust delivery (pace, tone, energy), prompt the model via `instructions` — e.g. "Speak slowly and calmly."

```json theme={null}
{
  "type": "session.update",
  "session": {
    "model": "higgs-realtime",
    "audio": { "output": { "voice": "default" } }
  }
}
```

## Audio format

### Supported codecs

| Format | Encoding | Sample rates |
| - | - | - |
| `audio/pcm` (default) | PCM16, little-endian, mono | 8000 / 16000 / 24000 / 48000 Hz (default 24000) |
| `audio/pcmu` | G.711 μ-law | 8000 Hz fixed |
| `audio/opus` | Opus | 24000 Hz internal; `frame_size_ms` of 2.5, 5, 10, 20 (default), 40, or 60 |

Internal processing always runs at 24 kHz, 16-bit, mono PCM. Audio travels base64-encoded inside JSON events.

### Configuration example

```json theme={null}
{
  "type": "session.update",
  "session": {
    "model": "higgs-realtime",
    "audio": {
      "input":  { "format": { "type": "audio/pcm", "rate": 16000 } },
      "output": { "format": { "type": "audio/pcm", "rate": 16000 } }
    }
  }
}
```


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.