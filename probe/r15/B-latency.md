# B — latency & turn-taking, higgs-realtime (1.0) vs higgs-realtime-1.5-preview (Phase 1, Oct 23, key 2)

Script: lat.py (summary per run in B-runs.jsonl, raw events in B-latency.jsonl), table: `python3 B-summ.py`. Runs interleaved 1.0/1.5, sequential. Cells: median [min–max] seconds.

| model | mode | instr | N | ended | no stopped / no created / no done | speech end→stopped (VAD) | speech end→1st audio (user wait) | stopped→1st audio | 1st audio→done (gen time, not speaking time) | out audio s | create→1st text | create→done |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| higgs-realtime | audio | 55 | 8 | 8/8 | 0/0/0 | 0.56 [0.55–0.84] | 0.92 [0.90–1.18] | 0.36 [0.07–0.56] | 1.41 [1.15–1.55] | 10.32 [9.32–11.08] | – | – |
| higgs-realtime-1.5-preview | audio | 55 | 8 | 8/8 | 0/0/0 | 0.56 [0.55–0.67] | 1.00 [0.95–1.17] | 0.44 [0.41–0.50] | 1.31 [1.08–1.78] | 11.72 [8.88–13.64] | – | – |
| higgs-realtime | audio | 3000 | 3 | 3/3 | 0/0/0 | 0.56 [0.56–0.59] | 0.89 [0.89–1.00] | 0.34 [0.33–0.41] | 1.35 [1.05–1.48] | 8.96 [8.96–10.68] | – | – |
| higgs-realtime-1.5-preview | audio | 3000 | 3 | 3/3 | 0/0/0 | 0.55 [0.55–0.62] | 0.96 [0.94–1.07] | 0.41 [0.39–0.45] | 1.33 [1.19–1.37] | 10.36 [9.52–10.80] | – | – |
| higgs-realtime | text | 55 | 5 | 5/5 | -/0/0 | – | – | – | – | – | 0.11 [0.10–0.13] | 0.51 [0.46–0.53] |
| higgs-realtime-1.5-preview | text | 55 | 5 | 5/5 | -/0/0 | – | – | – | – | – | 0.18 [0.16–0.41] | 0.40 [0.30–0.73] |
| higgs-realtime | text | 3000 | 3 | 3/3 | -/0/0 | – | – | – | – | – | 0.15 [0.12–0.16] | 0.45 [0.41–0.45] |
| higgs-realtime-1.5-preview | text | 3000 | 3 | 3/3 | -/0/0 | – | – | – | – | – | 0.21 [0.20–0.28] | 0.40 [0.36–0.41] |

Failed runs:

## Notes
- **Turn ended in 22/22 runs on 1.5 (11 VAD-audio) and 22/22 on 1.0.** The earlier 1-in-4 "no speech_stopped" flake on 1.5 did not reproduce.
- VAD is the same on both models: `audio_end_ms` = 6196 in every run on both models, and speech end→`speech_stopped` is 0.56 s on both. It looks like a shared front end.
- What the caller waits (end of speech → first audio) is ~0.9 s on 1.0 and ~1.0 s on 1.5. VAD accounts for ~0.56 s of that; the model accounts for 0.36 s (1.0) vs 0.44 s (1.5). 1.5 is ~80 ms slower and more consistent (1.0 has one 0.07 s run and one 0.56 s run).
- Text mode, which leaves out audio: create→first text is 0.11 s on 1.0 vs 0.18 s on 1.5, so the ~70 ms gap is model think-time, not TTS. 1.5 finishes text sooner (create→done 0.40 vs 0.51 s).
- Audio is generated ~8× faster than real time: ~10–12 s of audio arrives within ~1.3 s of the first chunk. `response.done` comes long before playback ends, so it can't be used as "finished speaking". 1.5 answers run slightly longer (11.7 vs 10.3 s of audio).
- A 3000-char instructions block has no measurable effect: audio is within ±40 ms, text is +40 ms on first token.
- Caveats: t0 is taken before connect, so the first ~0.3 s of audio is burst-sent and then paced at 20 ms; deltas are unaffected. One TTS clip, one voice, quiet input. N is small.

# Phase 2 — barge-in, VAD tuning, manual turns (key 2, bt.py → B2-runs.jsonl, table: `python3 B2-summ.py`)

The simulated mic now streams continuously (silence when idle), paced on a 20 ms clock that starts after connect. "Clip end" = when the last q.wav chunk was sent.

### Turn end: VAD variants and manual commit (one turn, continuous simulated mic)

| model | turn_detection | N | no reply | ended early (stopped before clip end) | extra turns | caller wait: clip end→1st audio | commit→1st audio |
|---|---|---|---|---|---|---|---|
| 1.0 | `null` | 4 | 0 | 0 | 0 | 0.47 [0.44–0.48] | 0.47 [0.44–0.48] |
| 1.0 | `{"type": "semantic_vad"}` | 4 | 0 | 4 | 0 | 0.86 [-4.34–1.04] | – |
| 1.5 | `null` | 4 | 0 | 0 | 0 | 0.52 [0.49–0.56] | 0.52 [0.49–0.56] |
| 1.5 | `{"type": "semantic_vad"}` | 4 | 0 | 4 | 0 | 0.72 [0.57–1.00] | – |
| 1.5 | `{"type": "server_vad", "silence_duration_ms": 200}` | 4 | 0 | 4 | 0 | 0.70 [0.67–0.73] | – |
| 1.5 | `{"type": "server_vad", "silence_duration_ms": 400}` | 4 | 0 | 0 | 0 | 0.85 [0.82–0.86] | – |
| 1.5 | `{"type": "server_vad", "threshold": 0.55}` | 4 | 0 | 0 | 0 | 0.92 [0.88–1.05] | – |
| 1.5 | `{"type": "server_vad"}` | 4 | 0 | 0 | 0 | 0.92 [0.89–0.99] | – |

### Barge-in (q.wav replayed once 1.5 s of reply audio had arrived)

| model | N | resp1 status | barge speech→speech_started | speech_started→last resp1 delta | speech_started→resp1 done | resp1 audio delivered s | stored resp1 text (item.retrieve) | truncated event |
|---|---|---|---|---|---|---|---|---|
| 1.0 | 4 | cancelled, cancelled, cancelled, cancelled | 0.29 [0.24–0.52] | -0.02 [-0.07–-0.00] | -0.00 [-0.02–0.00] | 6.07 [4.83–6.44] | 'The capital<|INTERRUPTED|>' / 'The capital<|INTERRUPTED|>' / 'The capital<|INTERRUPTED|>' / 'The capital<|INTERRUPTED|>' | 0/4 |
| 1.5 | 4 | cancelled, cancelled, cancelled, cancelled | 0.26 [0.24–0.55] | -0.00 [-0.11–0.00] | -0.00 [-0.00–0.00] | 5.77 [4.87–6.28] | 'The capital<|INTERRUPTED|>' / 'The capital<|INTERRUPTED|>' / 'The capital<|INTERRUPTED|>' / 'The capital<|INTERRUPTED|>' | 0/4 |

### Client response.cancel at the same point

| model | N | status | cancel→last delta | cancel→response.done | audio delivered s |
|---|---|---|---|---|---|
| 1.0 | 2 | cancelled, cancelled | 0.11 [0.11–0.11] | 0.11 [0.11–0.11] | 3.79 [3.67–3.91] |
| 1.5 | 2 | cancelled, cancelled | 0.06 [0.04–0.08] | 0.06 [0.04–0.09] | 3.81 [3.67–3.95] |

Errors/timeouts:


## Phase 2 notes
- **Manual turns work on both models.** With `turn_detection: null`, send `input_audio_buffer.commit`; `input_audio_buffer.committed` + `conversation.item.added` come back ~0.1 s later; then send a bare `response.create`. Commit→first audio is 0.47 s on 1.0 and 0.52 s on 1.5. That is ~0.4 s faster than the default VAD path, because the 0.5 s silence wait disappears. This contradicts the INDEX gotcha "with turn_detection null it never answers"; that probe most likely never committed.
- **Barge-in works the same on both models.** `speech_started` fires ~0.26 s after the interrupting speech begins, while response 1 is still streaming. In the same millisecond the server sends response 1's `response.done` with status `cancelled`; the done arrives 0–20 ms *before* `speech_started`, and the last audio delta arrives with it.
  - By that point the client has already received ~5–6 s of audio it hasn't played. It must flush its playback buffer on `speech_started` or on `response.done` with status cancelled.
  - The server sends no `conversation.item.truncated` and nothing about where it cut. But `conversation.item.retrieve` shows the stored assistant text cut to `"The capital<|INTERRUPTED|>"` in 8/8 runs. That is roughly 0.9 s of real-time playback from the first delta, so the server estimates the cut point assuming real-time playback.
  - `response.output_audio_transcript.done` still carries the full generated text. Don't use it as "what the user heard".
- **Next turn after a barge-in:** both models simply answered the repeated question in full, with no mention of being cut off. This is a weak test, since the interruption repeated the same question.
- **Client `response.cancel`:** `response.done` with status `cancelled` arrives in 0.04–0.11 s, and audio stops at the same moment. It behaves the same as a barge-in, minus the new user turn.
- **VAD tuning on 1.5:**
  - `silence_duration_ms` 400 is the sweet spot: wait 0.85 s vs 0.92 s at the default, and no early commits.
  - At 200 the wait is 0.70 s, but every run committed twice mid-sentence: the first time after the first word (~0.3 s in, "Quick"), the second after "quick question" (~1.6 s in).
  - `threshold` 0.55 makes no difference on clean TTS input.
- **`semantic_vad`** is accepted on both models, but it does not hold the turn through pauses. It commits and sends `response.created` at the first pauses just like silence_duration 200. In 1 of 4 runs on 1.0 it actually answered "Hello!" after the first word, and that response was cancelled when speech resumed. 1.5 caller wait was 0.72 s.
- **Gotcha: premature turns leave dangling responses.** Each mid-sentence commit produces `response.created` (in_progress) with **no `response.done` ever** and no audio. Clients that track responses by created/done will leak state. The final reply still answers the whole question, because all the split user items stay in context.
