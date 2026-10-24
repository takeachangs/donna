> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Voices

> Use preset voices, reference audio, or reusable custom voices with Higgs TTS 3.

Choose a preset voice, clone a voice from reference audio, or create a reusable custom voice.

## Preset voices

| Voice | Style | Sample input | Sample audio |
| - | - | - | - |
| `chloe` | A friendly and clear female voice with an engaging, informative tone and a standard American accent. | `<\|emotion:amusement\|>Hi, I'm Chloe Adams! <\|emotion:enthusiasm\|>I love showing you the little tricks that make everything click so much faster. <\|prosody:pause\|> Ready? Let's jump right in and make this easy and fun.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/Chloe_Adams_intro.mp3" /> |
| `eleanor` | A calm, articulate female voice with a clear, professional Standard American English accent, perfect for educational or explanatory content. | `<\|emotion:contentment\|>Hello, I'm Eleanor Reed. I love making tricky ideas feel simple and easy to follow. <\|prosody:speed_slow\|>We'll take it one step at a time, no rushing. <\|emotion:awe\|>And honestly, there's something wonderful about the moment when it all clicks.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/Eleanor_Reed_intro.mp3" /> |
| `jake` | A male speaker with an energetic and slightly dramatic tone, conveying passion and enthusiasm, especially about sports. | `<\|emotion:enthusiasm\|>What's up, I'm Jake Rivers! <\|emotion:elation\|>I live for the big moments, the buzzer-beaters, the comebacks, the whole roller coaster. <\|sfx:laughter\|>Haha, win or lose, I'm all in, and trust me, I bring the energy every single time!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/Jake_Rivers_intro.mp3" /> |
| `marcus` | A male speaker with an enthusiastic, confident, and slightly professorial American delivery. | `<\|emotion:enthusiasm\|>Hello, I'm Marcus Webb, and I genuinely get excited about ideas. <\|emotion:elation\|>Give me any topic and I'll happily walk you through it like it's the most fascinating thing in the world. <\|sfx:laughter\|>Haha, fair warning, I do tend to ramble when something's interesting!` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/Marcus_Webb_intro.mp3" /> |
| `nora` | A female speaker with a calm, clear, and narrative voice, using standard American English. | `<\|emotion:contentment\|>Hi there, I'm Nora Vance. I have a soft spot for stories <\|prosody:pause\|> the kind that pull you in slowly. <\|prosody:speed_slow\|>So settle in, and let me paint you a little picture of wherever we're headed.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/Nora_Vance_intro.mp3" /> |
| `oliver` | A calm, articulate male voice with a thoughtful American accent, well-suited for explanatory or reflective content. | `<\|emotion:contemplation\|>Hi, I'm Oliver Grant. I tend to think out loud, slowly working my way toward what really matters. <\|prosody:pause\|> Self-awareness, meaning, the quiet questions, that's where I like to linger. <\|emotion:contentment\|>Pull up a chair and let's reflect together.` | <audio controls src="https://docs.boson.ai/public/audio/higgs-audio-tts-voices/Oliver_Grant_intro.mp3" /> |

Use `voice` to select a preset speaker.

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "Hello, this is a test.",
    "voice": "berlinda"
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
        "voice": "berlinda"
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
    voice: "oliver",
  }),
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

## Reference voice

Clone a voice instantly with `ref_audio` and `ref_text`.

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
        "ref_text": "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable."
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
    "ref_audio": "https://docs.boson.ai/public/audio/sample.mp3",
    "ref_text": "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable."
  }),
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

`ref_audio` can be a URL or the base64-encoded bytes of a local audio file. Supported formats are `wav`, `mp3`, `opus`, `pcm` and `flac`.

We recommend 5-30 seconds of clean speech, with no music or background voices. Although `ref_text` is optional, we recommend providing a verbatim transcript of the reference audio, including filler words.

> [!WARNING]
>
> You must own the right to clone the voice.

## Custom voices

Custom voices work like reference voices, but you can reuse the returned `voice` ID instead of sending `ref_audio` on every request.

First, create a voice ID from reference audio and text. Then pass that ID to `voice`, just like a preset voice.

```bash cURL theme={null}
# 1) Create a reusable voice from reference audio — returns a voice_id.
curl https://api.boson.ai/v1/audio/voices \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ref_audio": "https://docs.boson.ai/public/audio/sample.mp3",
    "ref_text": "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable.",
    "title": "My Voice"
  }'
# => {"voice_id": "voice_abc123...", "title": "My Voice", "created_at": "...", "ref_text": "..."}

# 2) Reuse it on any request by passing the voice_id to "voice".
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "higgs-tts-3",
    "input": "Using my saved voice.",
    "voice": "voice_abc123..."
  }' \
  --output out.mp3
```

```python Python theme={null}
import os
import requests

API = "https://api.boson.ai/v1"
headers = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}

# 1) Create a reusable voice from reference audio — returns a voice_id.
created = requests.post(
    f"{API}/audio/voices",
    headers=headers,
    json={
        "ref_audio": "https://docs.boson.ai/public/audio/sample.mp3",
        "ref_text": "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable.",
        "title": "My Voice",
    },
)
created.raise_for_status()
voice_id = created.json()["voice_id"]

# 2) Reuse it on any request by passing the voice_id to "voice".
resp = requests.post(
    f"{API}/audio/speech",
    headers=headers,
    json={
        "model": "higgs-tts-3",
        "input": "Using my saved voice.",
        "voice": voice_id,
    },
)
resp.raise_for_status()
with open("out.mp3", "wb") as f:
    f.write(resp.content)
```

```typescript TypeScript theme={null}
import { writeFile } from "node:fs/promises";

const API = "https://api.boson.ai/v1";
const headers = {
  Authorization: `Bearer ${process.env.BOSON_API_KEY}`,
  "Content-Type": "application/json",
};

// 1) Create a reusable voice from reference audio — returns a voice_id.
const created = await fetch(`${API}/audio/voices`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    ref_audio: "https://docs.boson.ai/public/audio/sample.mp3",
    ref_text:
      "Same voice, same words, and uh, a completely different presence. I was built for chat native voice, real-time, expressive, and controllable.",
    title: "My Voice",
  }),
});
const { voice_id } = await created.json();

// 2) Reuse it on any request by passing the voice_id to "voice".
const res = await fetch(`${API}/audio/speech`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: "higgs-tts-3",
    input: "Using my saved voice.",
    voice: voice_id,
  }),
});
await writeFile("out.mp3", Buffer.from(await res.arrayBuffer()));
```

`ref_audio` accepts a URL or the base64-encoded bytes of a local file. Reusing the same audio returns the same `voice_id`, so creating a voice is safe to repeat.

### Deleting a custom voice

`DELETE /v1/audio/voices/{voice_id}` removes the reference audio for one of your
own voices. The voice stops working on `/v1/audio/speech` and disappears from
`GET /v1/audio/voices`.

```bash cURL theme={null}
curl -X DELETE https://api.boson.ai/v1/audio/voices/voice_abc123... \
  -H "Authorization: Bearer $BOSON_API_KEY"
# => {"voice_id": "voice_abc123...", "object": "voice", "deleted": true}
```

```python Python theme={null}
resp = requests.delete(f"{API}/audio/voices/{voice_id}", headers=headers)
resp.raise_for_status()
```

```typescript TypeScript theme={null}
await fetch(`${API}/audio/voices/${voice_id}`, { method: "DELETE", headers });
```

A few things to know:

* You can only delete voices you created. Deleting a voice that does not exist,
  belongs to another key, or was already deleted all return `404
  voice_not_found` — the three are not distinguished, so no key can use this
  endpoint to discover another account's voice IDs.
* **Preset voices cannot be deleted** and return `403 voice_not_deletable`.
* Deleting is not reversible, but it is not destructive either: because
  `voice_id` is derived from the audio itself, re-creating the voice with the
  same `ref_audio` gives you back the same `voice_id`.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.