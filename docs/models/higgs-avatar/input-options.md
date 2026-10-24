> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Inputs and limits

> Choose audio or text input, upload local assets, and check Higgs Avatar sizes, limits, and common errors.

Every Avatar request needs a `ref_image` plus exactly one driving input:

| Input | Use when | Request field |
| - | - | - |
| Existing audio | You already have the voice performance | `input` |
| Text-to-speech | Higgs TTS should generate the driving voice | `input_tts` |

`ref_image` and `input` accept an HTTPS URL, data URI, base64 value, or multipart file upload.

## Drive with an audio clip

Pass the driving voice in `input`. The avatar lip-syncs and moves to the audio, and the audio duration determines the video length.

```json theme={null}
{
  "model": "higgs-avatar",
  "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
  "input": "https://docs.boson.ai/public/audio/sample.mp3",
  "size": "640x640"
}
```

For a complete create, poll, and download example, follow the [quickstart](https://docs.boson.ai/models/higgs-avatar/overview.md#quickstart).

## Drive with text

Put a [Higgs TTS request](https://docs.boson.ai/models/higgs-tts/overview.md) under `input_tts`. Choose a reusable `voice`, or supply TTS voice-cloning inputs. Do not send `input` in the same request.

```bash cURL theme={null}
curl -s https://api.boson.ai/v1/videos \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-avatar",
    "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
    "input_tts": {
      "model": "higgs-tts-3",
      "input": "Hello, world.",
      "voice": "default"
    },
    "size": "640x640"
  }'
```

```python Python theme={null}
import os

import requests


response = requests.post(
    "https://api.boson.ai/v1/videos",
    headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
    json={
        "model": "higgs-avatar",
        "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
        "input_tts": {
            "model": "higgs-tts-3",
            "input": "Hello, world.",
            "voice": "default",
        },
        "size": "640x640",
    },
)
response.raise_for_status()
print(response.json())
```

```typescript TypeScript theme={null}
const response = await fetch("https://api.boson.ai/v1/videos", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-avatar",
    ref_image: "https://docs.boson.ai/public/avatar/sample.jpg",
    input_tts: {
      model: "higgs-tts-3",
      input: "Hello, world.",
      voice: "default",
    },
    size: "640x640",
  }),
});

if (!response.ok) throw new Error(await response.text());
console.log(await response.json());
```

## Upload local files

Use `multipart/form-data` to upload a local image and audio clip without base64 encoding. When driving with text, pass `input_tts` as a JSON-string form field.

```bash cURL theme={null}
curl -s https://api.boson.ai/v1/videos \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -F model=higgs-avatar \
  -F size=480x640 \
  -F ref_image=@face.png \
  -F input=@voice.wav
```

```python Python theme={null}
import os

import requests


with open("face.png", "rb") as ref_image, open("voice.wav", "rb") as input_audio:
    response = requests.post(
        "https://api.boson.ai/v1/videos",
        headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
        data={
            "model": "higgs-avatar",
            "size": "480x640",
        },
        files={
            "ref_image": ref_image,
            "input": input_audio,
        },
    )

response.raise_for_status()
print(response.json())
```

```typescript TypeScript theme={null}
import { readFile } from "node:fs/promises";

const form = new FormData();
form.set("model", "higgs-avatar");
form.set("size", "480x640");
form.set("ref_image", new Blob([await readFile("face.png")]), "face.png");
form.set("input", new Blob([await readFile("voice.wav")]), "voice.wav");

const response = await fetch("https://api.boson.ai/v1/videos", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
  },
  body: form,
});

if (!response.ok) throw new Error(await response.text());
console.log(await response.json());
```

## Output sizes

Choose the aspect ratio that best matches the reference image so the subject is not cropped.

| `size` | Aspect ratio | Use for |
| - | - | - |
| `640x640` | 1:1 | Square, the default |
| `640x480` | 4:3 | Landscape |
| `480x640` | 3:4 | Portrait |

## Input limits

| Field | Limit |
| - | - |
| `ref_image` | PNG, JPEG, or WebP; inline base64 or data URI up to 10 MB |
| `input` | AAC, WAV, MP3, FLAC, or Opus; up to 60 seconds |
| `input_tts.input` | Up to 5,000 characters |

Assets supplied by URL are fetched by the service and are not subject to the inline payload-size limit.

## Common request errors

| Error code | What to check |
| - | - |
| `invalid_image_format` | Use a supported reference-image format |
| `payload_too_large` | Reduce an inline image or audio payload |
| `audio_too_long` | Keep the driving audio at or below 60 seconds |
| `input_too_long` | Shorten the text sent to Higgs TTS |
| `invalid_size` | Use one of the documented output-size presets |
| `model_not_found` | Use the published `higgs-avatar` model identifier |

For failed jobs, log the video ID and complete error object so the request can be traced.

> **[Stream generated video](https://docs.boson.ai/models/higgs-avatar/streaming-video.md)**
>
> Use the same audio-driven or text-driven body with the streaming endpoint.

> **[Avatar API reference](https://docs.boson.ai/api-reference/videos/create-a-video.md)**
>
> Look up every request field and additional option.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.