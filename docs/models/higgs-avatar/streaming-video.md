> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Streaming video

> Receive fragmented MP4 from Higgs Avatar so playback can begin before generation finishes.

Use `POST /v1/videos/stream` when your application should start receiving video before the complete clip is rendered. The request body matches `POST /v1/videos`, but the response body is a fragmented-MP4 byte stream.

> [!NOTE]
>
> Streaming changes delivery, not the interaction model. A video job generates a clip from supplied image and audio or text; it does not create a persistent conversational session. For a live avatar in a conversation, see [Realtime sessions](https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md).

## How streaming works

* Video fragments arrive as they are generated.
* The video ID is returned in the `X-Video-Id` response header.
* The complete MP4 is stored, so it can still be downloaded later from `GET /v1/videos/{video_id}/content`.
* Browsers can append fragments to a Media Source Extensions `SourceBuffer`.

## Stream to a file

```bash cURL theme={null}
curl -N https://api.boson.ai/v1/videos/stream \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-avatar",
    "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
    "input": "https://docs.boson.ai/public/audio/sample.mp3",
    "size": "640x640"
  }' \
  --output out.mp4
```

```python Python theme={null}
import os

import requests


payload = {
    "model": "higgs-avatar",
    "ref_image": "https://docs.boson.ai/public/avatar/sample.jpg",
    "input": "https://docs.boson.ai/public/audio/sample.mp3",
    "size": "640x640",
}

with open("out.mp4", "wb") as file, requests.post(
    "https://api.boson.ai/v1/videos/stream",
    headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"},
    json=payload,
    stream=True,
    timeout=300,
) as response:
    response.raise_for_status()
    video_id = response.headers["X-Video-Id"]

    for chunk in response.iter_content(chunk_size=8192):
        if chunk:
            file.write(chunk)

print(f"Saved out.mp4 from video {video_id}")
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const response = await fetch("https://api.boson.ai/v1/videos/stream", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "higgs-avatar",
    ref_image: "https://docs.boson.ai/public/avatar/sample.jpg",
    input: "https://docs.boson.ai/public/audio/sample.mp3",
    size: "640x640",
  }),
});

if (!response.ok || !response.body) {
  throw new Error(await response.text());
}

const chunks: Uint8Array[] = [];
const reader = response.body.getReader();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  if (value) chunks.push(value);
}

await writeFile("out.mp4", Buffer.concat(chunks));
console.log(`video id: ${response.headers.get("X-Video-Id")}`);
```

> [!TIP]
>
> Streaming is working when response bytes begin arriving before generation completes and the resulting `out.mp4` opens successfully.

## Play fragments in a browser

Use the [Media Source Extensions API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API) to append incoming fragmented-MP4 chunks to a `SourceBuffer`. Your application should also handle network interruption, buffer backpressure, and unsupported codecs.

> **[Choose an input](https://docs.boson.ai/models/higgs-avatar/input-options.md)**
>
> Use the same audio-driven or text-driven body with the streaming endpoint.

> **[Streaming endpoint reference](https://docs.boson.ai/api-reference/videos/create-a-video-streaming.md)**
>
> Look up the endpoint contract and response details.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.