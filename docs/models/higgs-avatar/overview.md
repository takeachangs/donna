> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Generate talking-head video from a still image and a driving voice or text.

Higgs Avatar turns a single still image into talking-head video with lip sync, head motion, and expression aligned to the driving voice.

```text Model theme={null}
higgs-avatar
```

```text Video jobs endpoint (POST) theme={null}
https://api.boson.ai/v1/videos
```

```text Streaming endpoint (POST) theme={null}
https://api.boson.ai/v1/videos/stream
```

## What you can build

| Capability | Input | Output |
| - | - | - |
| Audio-driven video | Still image and an existing audio clip | Rendered MP4 or fragmented-MP4 stream |
| Text-driven video | Still image and a Higgs TTS request | Rendered MP4 or fragmented-MP4 stream |
| Instant avatar cloning | One PNG, JPEG, or WebP image | A new talking-head performance without avatar training |

“Streaming” describes how generated video is delivered. Higgs Avatar does not manage a persistent, two-way conversation itself; the same `higgs-avatar` model also serves [realtime sessions](https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md), which lip-sync your voice agent's speech live in a LiveKit room.

## Quickstart

This quickstart creates an audio-driven video from Boson AI-hosted sample assets. A successful run saves the finished result as `out.mp4`.

### Before you begin

You need:

* A [Boson API key](https://docs.boson.ai/authentication.md) stored in `BOSON_API_KEY`
* Available credit — new accounts must claim their [free trial credit](https://docs.boson.ai/free-trial-credit.md) before their first API call
* cURL and `jq`, Python 3.10 with `requests`, or Node.js 18 or later

```bash theme={null}
export BOSON_API_KEY="bai-xxxx"
```

### Create, wait, and download

Avatar video generation is asynchronous:

1. `POST /v1/videos` creates a job and returns a Video object with an `id`.
2. `GET /v1/videos/{video_id}` reports progress until the job is `completed` or `failed`.
3. `GET /v1/videos/{video_id}/content` downloads the rendered MP4.

```bash cURL theme={null}
# 1. Create the video.
VIDEO_ID=$(curl -fsS https://api.boson.ai/v1/videos \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-avatar",
    "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
    "input": "https://docs.boson.ai/public/audio/sample.mp3",
    "size": "640x640"
  }' | jq -er .id)

# 2. Wait for the Video object to complete.
while true; do
  VIDEO=$(curl -fsS "https://api.boson.ai/v1/videos/$VIDEO_ID" \
    -H "Authorization: Bearer $BOSON_API_KEY")
  STATUS=$(printf '%s' "$VIDEO" | jq -r .status)

  [ "$STATUS" = "completed" ] && break
  if [ "$STATUS" = "failed" ]; then
    printf '%s' "$VIDEO" | jq .error >&2
    exit 1
  fi

  sleep 2
done

# 3. Download the rendered MP4.
curl -fsS "https://api.boson.ai/v1/videos/$VIDEO_ID/content" \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  --output out.mp4
```

```python Python theme={null}
import os
import time

import requests


base_url = "https://api.boson.ai/v1/videos"
headers = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}

video = requests.post(
    base_url,
    headers=headers,
    json={
        "model": "higgs-avatar",
        "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
        "input": "https://docs.boson.ai/public/audio/sample.mp3",
        "size": "640x640",
    },
)
video.raise_for_status()
video_id = video.json()["id"]

while True:
    status = requests.get(f"{base_url}/{video_id}", headers=headers)
    status.raise_for_status()
    current = status.json()

    if current["status"] == "completed":
        break
    if current["status"] == "failed":
        raise RuntimeError(current.get("error"))

    time.sleep(2)

content = requests.get(f"{base_url}/{video_id}/content", headers=headers)
content.raise_for_status()

with open("out.mp4", "wb") as file:
    file.write(content.content)

print(f"Saved out.mp4 from video {video_id}")
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const baseURL = "https://api.boson.ai/v1/videos";
const authorization = `Bearer ${process.env.BOSON_API_KEY}`;

const createResponse = await fetch(baseURL, {
  method: "POST",
  headers: {
    Authorization: authorization,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-avatar",
    ref_image: "https://docs.boson.ai/public/avatar/sample.jpg",
    input: "https://docs.boson.ai/public/audio/sample.mp3",
    size: "640x640",
  }),
});

if (!createResponse.ok) throw new Error(await createResponse.text());
const video = await createResponse.json();

while (true) {
  const statusResponse = await fetch(`${baseURL}/${video.id}`, {
    headers: { Authorization: authorization },
  });
  if (!statusResponse.ok) throw new Error(await statusResponse.text());

  const current = await statusResponse.json();
  if (current.status === "completed") break;
  if (current.status === "failed") throw new Error(JSON.stringify(current.error));

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const contentResponse = await fetch(`${baseURL}/${video.id}/content`, {
  headers: { Authorization: authorization },
});
if (!contentResponse.ok) throw new Error(await contentResponse.text());

await writeFile("out.mp4", Buffer.from(await contentResponse.arrayBuffer()));
console.log(`Saved out.mp4 from video ${video.id}`);
```

> [!TIP]
>
> The integration is working when the job reaches `completed` and `out.mp4` opens in your video player.

### Job states

`GET /v1/videos/{video_id}` returns the current Video object.

| Status | Meaning | Client action |
| - | - | - |
| `queued` | The job is waiting to start | Continue polling with backoff |
| `in_progress` | Video generation is running | Continue polling |
| `completed` | The MP4 is ready | Download content |
| `failed` | Generation stopped | Inspect the Video object's `error` |

`GET /v1/videos/{video_id}/content` downloads the rendered MP4 after completion. It returns `404` while content is not yet available.

## Next steps

> **[Choose inputs and limits](https://docs.boson.ai/models/higgs-avatar/input-options.md)**
>
> Generate from audio or text, upload local files, and check supported sizes and limits.

> **[Stream generated video](https://docs.boson.ai/models/higgs-avatar/streaming-video.md)**
>
> Start playback before the complete video is rendered with fragmented MP4.

> **[Run a realtime session](https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md)**
>
> Put a live, lip-synced avatar into your LiveKit voice agent's room. Requires your own LiveKit Cloud project.

> **[Avatar API reference](https://docs.boson.ai/api-reference/videos/create-a-video.md)**
>
> Look up the generated video endpoints and field-level request details.

## Try it in the playground

The fastest way to preview the model is the [Boson AI playground](https://www.boson.ai/workspace). Pick an avatar, paste text, and press play.

## When to use another Higgs API

> **[Need generated speech only?](https://docs.boson.ai/models/higgs-tts/overview.md)**
>
> Use Higgs TTS 3 when your output is audio and you do not need a talking-head video.

> **[Need a live conversation?](https://docs.boson.ai/models/higgs-realtime/overview.md)**
>
> Use Higgs Realtime for a persistent, interruptible audio or text session with tool calling.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.