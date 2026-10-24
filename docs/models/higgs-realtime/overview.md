> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Build realtime voice assistants over WebSocket with streaming audio, text, turn detection, and tool calling.

The Realtime API enables real-time bidirectional voice communication over WebSocket (WebRTC support is in progress). Stream audio and text both ways for voice assistants, phone agents, and interactive voice systems: the model listens and speaks natively in a single full-duplex session — no separate transcription or synthesis steps to manage.

```text Model theme={null}
higgs-realtime
```

```text WebSocket endpoint theme={null}
wss://api.boson.ai/v1/realtime
```

## Features

* **Full-duplex voice** — one persistent session streams audio and text in both directions; the model listens and speaks natively.
* **Turn detection and barge-in** — `server_vad` and `semantic_vad` detect end of turn and reply automatically; interruptions always stop the model mid-utterance. See [Turn detection](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions.md).
* **Tool calling** — `function` tools with JSON-schema parameters, called mid-conversation. See [Tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md).
* **Voices** — the `default` voice, Boson AI presets, or your own cloned `voice_<id>`. See [Audio & voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices.md).
* **Input transcription** — live user-speech transcripts via `higgs-stt-3.1`.
* **Text mode** — set `output_modalities` to `["text"]` to stream text instead of spoken audio.
* **OpenAI-compatible protocol** — the event protocol is compatible with OpenAI's GA Realtime API; most integrations move with config changes. See [Migrate an existing integration](https://docs.boson.ai/models/higgs-realtime/migrate-an-existing-integration.md).
* **Browser and mobile clients** — trusted servers mint short-lived [client secrets](https://docs.boson.ai/api-reference/realtime/client-secrets.md) so keys never ship to devices.

## Start building

> **[Quickstart](https://docs.boson.ai/models/higgs-realtime/quickstart.md)**
>
> Every step from a fresh account to a working voice assistant.

> **[API reference](https://docs.boson.ai/api-reference/realtime/overview.md)**
>
> Every client and server event, close codes, and session fields.

> **[LiveKit & Pipecat integrations](https://docs.boson.ai/models/higgs-realtime/integrations/livekit.md)**
>
> Production voice-agent frameworks with Higgs Realtime built in.

> **[Migrate from OpenAI](https://docs.boson.ai/models/higgs-realtime/migrate-an-existing-integration.md)**
>
> Move an existing OpenAI Realtime integration over.

> **[Higgs Realtime API — a tutorial](https://github.com/boson-ai/higgs-realtime-tutorial)**
>
> Six parts in TypeScript and React, from zero to a working browser voice assistant — with a git checkpoint after every part.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.