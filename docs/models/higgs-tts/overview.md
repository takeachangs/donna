> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Chat-native text-to-speech with streaming, 100 languages, instant voice cloning, and inline emotion and style control.

```text Model theme={null}
higgs-tts-3
```

```text Speech endpoint (POST) theme={null}
https://api.boson.ai/v1/audio/speech
```

> [!NOTE]
>
> Need a model that listens and responds across turns? Use [Higgs Realtime](https://docs.boson.ai/models/higgs-realtime/overview.md). Higgs TTS 3 renders speech from text; it does not manage a conversation.

## Features

* **Chat-native, low-latency streaming** — begin speaking before the full input is finalized.
* **100 languages** — single-digit WER/CER coverage. See [Languages](https://docs.boson.ai/models/higgs-tts/languages.md).
* **Instant voice cloning** — zero-shot from a short reference clip and its transcript. See [Voices](https://docs.boson.ai/models/higgs-tts/voices.md).
* **Inline control tags** — shape emotion, style, prosody, and sound effects with `<|emotion:…|>`, `<|style:…|>`, `<|prosody:…|>`, and `<|sfx:…|>`. See [Tags](https://docs.boson.ai/models/higgs-tts/tags.md).

## Try it in the playground

The fastest way to hear the model is the [playground](https://www.boson.ai/workspace). Pick a voice, paste text, and press play.

## Generate speech with the API

You need a [Boson API key](https://docs.boson.ai/authentication.md) stored in `BOSON_API_KEY`, and available credit — new accounts must claim their [free trial credit](https://docs.boson.ai/free-trial-credit.md) before their first API call. Set the key in your shell for the current session:

```bash theme={null}
export BOSON_API_KEY=bai-xxxx
```

A minimal request needs `Authorization`, `model`, and `input`. Everything else is optional.

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "Hello, this is a test."
  }' \
  --output out.mp3
```

```python Python theme={null}
import os
import requests

resp = requests.post(
    "https://api.boson.ai/v1/audio/speech",
    headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
    json={
        "model": "higgs-tts-3",
        "input": "Hello, this is a test.",
    },
)
resp.raise_for_status()
with open("out.mp3", "wb") as f:
    f.write(resp.content)
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const res = await fetch("https://api.boson.ai/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-tts-3",
    input: "Hello, this is a test.",
  }),
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

## Use a preset voice

Use `voice` to choose a preset speaker.

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "Hello, this is a test.",
    "voice": "jake"
  }' \
  --output out.mp3
```

```python Python theme={null}
import os
import requests

resp = requests.post(
    "https://api.boson.ai/v1/audio/speech",
    headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
    json={
        "model": "higgs-tts-3",
        "input": "Hello, this is a test.",
        "voice": "jake",
    },
)
resp.raise_for_status()
with open("out.mp3", "wb") as f:
    f.write(resp.content)
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const res = await fetch("https://api.boson.ai/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-tts-3",
    input: "Hello, this is a test.",
    voice: "jake",
  }),
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

See [Voices](https://docs.boson.ai/models/higgs-tts/voices.md#preset-voices) for more preset speakers and samples.

## Use reference audio

Use `ref_audio` to clone a voice from a short reference clip. Passing the audio transcript through `ref_text` can often improve generated audio quality.

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "Hello, this is a test.",
    "ref_audio": "https://docs.boson.ai/public/audio/sample.mp3",
    "ref_text": "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable."
  }' \
  --output out.mp3
```

```python Python theme={null}
import os
import requests

resp = requests.post(
    "https://api.boson.ai/v1/audio/speech",
    headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
    json={
        "model": "higgs-tts-3",
        "input": "Hello, this is a test.",
        "ref_audio": "https://docs.boson.ai/public/audio/sample.mp3",
        "ref_text": "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable.",
    },
)
resp.raise_for_status()
with open("out.mp3", "wb") as f:
    f.write(resp.content)
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const res = await fetch("https://api.boson.ai/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-tts-3",
    input: "Hello, this is a test.",
    ref_audio: "https://docs.boson.ai/public/audio/sample.mp3",
    ref_text:
      "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable.",
  }),
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

To clone from a **local** file, either encode local file as base64 string or send as \`multipart/form-data. Below code shows the latter.

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -F model=higgs-tts-3 \
  -F input="Hello, this is a test." \
  -F ref_audio=@voice.wav \
  -F ref_text="Transcript of the reference clip." \
  --output out.mp3
```

```python Python theme={null}
import os
import requests

with open("voice.wav", "rb") as ref_audio:
    resp = requests.post(
        "https://api.boson.ai/v1/audio/speech",
        headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
        data={
            "model": "higgs-tts-3",
            "input": "Hello, this is a test.",
            "ref_text": "Transcript of the reference clip.",
        },
        files={"ref_audio": ref_audio},
    )

resp.raise_for_status()
with open("out.mp3", "wb") as f:
    f.write(resp.content)
```

```typescript TypeScript theme={null}
import { readFile, writeFile } from "node:fs/promises";

const form = new FormData();
form.set("model", "higgs-tts-3");
form.set("input", "Hello, this is a test.");
form.set("ref_text", "Transcript of the reference clip.");
form.set("ref_audio", new Blob([await readFile("voice.wav")]), "voice.wav");

const res = await fetch("https://api.boson.ai/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
  },
  body: form,
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

> [!WARNING]
>
> You must own the right to clone the voice.

See [Voices](https://docs.boson.ai/models/higgs-tts/voices.md#reference-voice) for best practices and reusable custom voices.

## Fine-grained control

Inline tags control emotion, style, prosody, and sound effects in the generated audio. Add them to `input`, and the model adjusts the surrounding speech. For example:

| Sample input | Sample audio |
| - | - |
| `<\|emotion:enthusiasm\|>Welcome to the show! <\|prosody:pause\|>Let's get started!` | `voice: "jake"` <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/fine-grained-control-jake.mp3" /> |

See [Tags](https://docs.boson.ai/models/higgs-tts/tags.md) for the complete list and sample audio.

## Text normalization

Normalization rewrites the input so the model speaks it the way a person would read it aloud, expanding numbers, dates, times, currency, units, URLs, email addresses, phone numbers, abbreviations, and symbols into spoken form. It is on by default and leaves inline [tags](https://docs.boson.ai/models/higgs-tts/tags.md) and ordinary prose untouched. Set `normalize: false` to synthesize the text exactly as written.

| Sample input | Sample audio |
| - | - |
| `Your appointment is on Thu, Mar 3rd at 8:05 AM. The total is $1,250.75, and the balance of $89.50 is due by 5 PM on 3/17. See https://docs.boson.ai/models/higgs-tts/overview or call us at (415) 555-0142.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-tn/text-normalization-example.mp3" /> |

If `language` is not set, normalization infers the language from the text. If you know the language, set `language` to its ISO 639-3 code, such as `eng` or `cmn`, for the most reliable results. Normalization does not run when [word-level timestamps](#word-level-timestamps) are requested.

## Word-level timestamps

Set `timestamps: true` to get the start and end time of every word alongside the audio.

> [!WARNING]
>
> `timestamps: true` changes the response from audio bytes to JSON, with the audio base64-encoded inside it. Writing the response body straight to a file produces an unplayable file. Decode `audio` first.

`response_format` still selects the audio format as usual; the encoded audio is returned in that format inside the envelope's `audio` field.

```json theme={null}
{
  "audio": "<base64-encoded audio in the requested response_format>",
  "response_format": "wav",
  "input": "The quick brown fox jumps over the lazy dog.",
  "timestamps": [
    { "word": "The", "start": 0.08, "end": 0.16 },
    { "word": "quick", "start": 0.16, "end": 0.48 },
    { "word": "brown", "start": 0.56, "end": 0.8 },
    { "word": "fox", "start": 0.8, "end": 1.36 },
    { "word": "jumps", "start": 1.36, "end": 1.76 },
    { "word": "over", "start": 1.76, "end": 2.0 },
    { "word": "the", "start": 2.0, "end": 2.08 },
    { "word": "lazy", "start": 2.08, "end": 2.48 },
    { "word": "dog", "start": 2.48, "end": 2.96 }
  ]
}
```

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "The quick brown fox jumps over the lazy dog.",
    "response_format": "wav",
    "timestamps": true
  }' | jq -r '.audio' | base64 -d > out.wav
```

```python Python theme={null}
import base64
import os
import requests

resp = requests.post(
    "https://api.boson.ai/v1/audio/speech",
    headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
    json={
        "model": "higgs-tts-3",
        "input": "The quick brown fox jumps over the lazy dog.",
        "response_format": "wav",
        "timestamps": True,
    },
)
resp.raise_for_status()
body = resp.json()

with open("out.wav", "wb") as f:
    f.write(base64.b64decode(body["audio"]))

for word in body["timestamps"] or []:
    print(f"{word['start']:.2f}-{word['end']:.2f} {word['word']}")
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const res = await fetch("https://api.boson.ai/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-tts-3",
    input: "The quick brown fox jumps over the lazy dog.",
    response_format: "wav",
    timestamps: true,
  }),
});

const body = await res.json();
await writeFile("out.wav", Buffer.from(body.audio, "base64"));

for (const word of body.timestamps ?? []) {
  console.log(`${word.start.toFixed(2)}-${word.end.toFixed(2)} ${word.word}`);
}
```

`timestamps` is `null` when alignment is unavailable, for example on very short inputs.

> [!NOTE]
>
> Word timestamps are currently available for English, Chinese, and Spanish. Other languages return `"timestamps": null`.

Timestamps require the full clip, so `stream` must be false. Setting both returns a 400 `timestamps_streaming_unsupported`. For the same reason, timestamped input is not split into segments the way other long input is, so we recommend keeping it to roughly 300 characters.

## Streaming response

When `stream: true`, set `response_format: "pcm"`.

Streaming is the best way to synthesize long text. Long input is split into segments, and the audio of each segment is sent as soon as it is synthesized, so playback can start long before the whole text is done. Streaming also raises the input limit to 50,000 characters.

```bash cURL theme={null}
curl -N https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "Hello, this is a streaming PCM test.",
    "response_format": "pcm",
    "stream": true
  }'
```

```python Python theme={null}
import os
import requests

BASE_URL = "https://api.boson.ai/v1"
API_KEY = os.environ["BOSON_API_KEY"]

payload = {
    "model": "higgs-tts-3",
    "input": "Hello, this is a streaming PCM test.",
    "voice": "default",
    "response_format": "pcm",
    "stream": True,
}

# The response body is a raw 16-bit / 24kHz / mono PCM byte stream — collect chunks directly.
pcm = bytearray()
with requests.post(
    f"{BASE_URL}/audio/speech",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json=payload,
    stream=True,
    timeout=180,
) as r:
    r.raise_for_status()
    for chunk in r.iter_content(chunk_size=4096):
        if chunk:                       # first non-empty chunk == time-to-first-audio
            pcm.extend(chunk)

with open("out.pcm", "wb") as f:
    f.write(pcm)
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const res = await fetch("https://api.boson.ai/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-tts-3",
    input: "Hello, this is a streaming PCM test.",
    response_format: "pcm",
    stream: true,
  }),
});

if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

// Raw 16-bit / 24kHz / mono PCM byte stream — no "data:" lines, just collect the bytes.
const reader = res.body.getReader();
const pcmChunks: Uint8Array[] = [];
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  if (value) pcmChunks.push(value);     // first chunk == time-to-first-audio
}

await writeFile("out.pcm", Buffer.concat(pcmChunks));
```

## API reference

Full request body:

```jsonc theme={null}
{
  "model": "higgs-tts-3",
  "input": "Text to synthesize.",
  "voice": "default",
  "response_format": "mp3",
  "stream": false,

  "ref_audio": "base64 | data URI | URL",
  "ref_text": "Transcript of the reference audio.",

  "normalize": true,
  "language": null,
  "timestamps": false
}
```

See the [API reference](https://docs.boson.ai/api-reference/audio/create-a-speech.md) for field details and additional options.

## Alternative ways to use the model

Beyond the hosted API, you can run the model yourself:

* **Hugging Face** — open model weights at [bosonai/higgs-tts-v3-4b](https://huggingface.co/bosonai/higgs-tts-v3-4b).
* **SGLang** — serve the model locally for high-throughput inference. See the [Higgs TTS cookbook](https://sgl-project.github.io/sglang-omni/cookbook/higgs_tts.html).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.