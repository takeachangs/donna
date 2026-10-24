# Tester C: session mechanics + audio formats, 1.5-preview vs 1.0 (Oct 23)

## 1. /v1/models
- `higgs-realtime-1.5-preview` entry is identical in shape to `higgs-realtime`: owned_by vllm, max_model_len 32768, metadata null. No new fields.
- New id in the list: `higgs-realtime-tts` (no max_model_len). Full list: higgs-realtime, higgs-stt-3.1, higgs-tts-v3, higgs-avatar, higgs-realtime-tts, qwen3-forced-aligner-0.6b, higgs-tts-mps, higgs-realtime-1.5-preview.

## 2. Audio formats on 1.5 (c_fmt.py: q.wav converted with sox to the format, fed via server_vad, same format out)
- `session.created` (arrives after our first session.update) ECHOES the applied audio config, incl. format. That's the 1.5 verification signal, since there's no session.updated.
| fmt | input STT | output deltas | out bytes / transcript char | verdict |
|-|-|-|-|-|
| pcm 24000 | exact | 2400 B (50 ms) | 3051 | ok (baseline) |
| **pcmu** | exact | 400 B (50 ms @ 8 kB/s) | 525 (= 3051/5.8) | **works both ways**: no 0x00 bytes, 0xFF/0x7F silence = real μ-law at 8 kHz |
| pcm 8000 | exact | 800 B | 1093 | ok |
| pcm 16000 | exact | 1600 B | 2076 | ok |
| pcm 48000 in+out | exact | none | - | **`upstream_error` 2/2 runs** right after commit. Split configs work: in24/out48 ok (4798 B deltas), in48/out24 ok. Only 48k-in AND 48k-out together fails. |
| opus (20 ms) | exact (ogg-demuxed libopus packets as appends) | ~48 B raw opus packets, TOC 0x68 (hybrid FB 20 ms mono) | 198 | ok, one packet per delta |

### 1.0 comparison (same script)
All six work on 1.0, incl. 48k in+out (4798 B deltas, 6567 B/char). pcmu: 400 B deltas, 526 B/char, μ-law byte profile. Opus: ~56 B packets, TOC 0x68. So the 48k+48k failure is 1.5-only.

### pcmu verdict: Twilio Media Streams format works natively on 1.5 (and 1.0), input and output, no resampling needed. 400 B = 50 ms per output delta Twilio accepts any size outbound, so forward deltas as-is; inbound 160 B/20 ms frames can be appended directly. Decoded output (sox u-law) = 11.56 s, matches the byte-rate estimate. E-twilio's design (`connect(rate=8000)` + μ-law table) works, but `audio/pcmu` both ways drops the table entirely.

## 3. Mid-call session.update (c_update.py, audio out, text in)
- **Gotcha correction (tested, c_created.py on 1.5):** the server sends NOTHING on connect (5 s silence). `session.created` is emitted only in reply to the first `session.update` and echoes the applied config; every later update gets `session.updated` (with full config). So "1.5 sends no session.updated" is wrong: the first update is acked by session.created. A client that waits for session.created before its first update hangs. 1.0 does the same for the first update.
- Partial updates merge: a voice-only patch kept the Spanish instructions.
- Instructions change takes effect next turn: French -> Spanish, on both models.
- Voice change mid-call works: default -> jake, median F0 215 Hz -> 119 Hz on 1.5 (188 -> 140 on 1.0); session.updated echoes voice "jake".
- Invalid voice mid-call -> `error` invalid_request_error "Invalid voice '...': not found"; session keeps the previous voice (F0 stayed ~100-130 Hz) and instructions; the call continues.

## 4. Second socket onto the same session (c_attach.py)
- session.id is 8 hex chars (e.g. 1fe89ba6). `?session=<id>`, `?session_id=<id>`, headers X-Session-Id / Session-Id / OpenAI-Session: every one gets a fresh session (new id, doesn't know ws1's secret word). ws1 unaffected. Same on 1.0. No attach/observer mechanism found.
- `channels: 2` in input/output format is silently dropped (session.created echo shows only type+rate). Mono only.

## Phase 2 suggestions
- Twilio end-to-end: pcmu passthrough at 20 ms frames with real phone audio (8 kHz STT quality, VAD threshold 0.85 on line noise).
- 48k+48k on 1.5: retry later (deployment bug?) and report to Boson; until then use 24k.
- Concurrency limits; session.max_duration_sec on 1.5 vs 1.0; idle timeout on 1.5.
- Since the first update rides on session.created: does a SECOND update before session.created arrive get its own session.updated?

# Phase 2 (started 20:47 EDT Oct 23)
## 3. Second session.update before session.created (c_order.py, 1.5)
- Both applied in order and merged: `session.created` echoes update #1 (French, temp 0.7, voice default), then `session.updated` echoes the merge (French, temp 0.7, voice jake). Next turn answered in French. Nothing dropped.
## Side note: upstream_error under parallel load
- Launched 6 sessions within ~1 s at 20:47:25 (plus other testers on the key): 4 of 6 got `upstream_error` on their first text response, 2 succeeded. Possibly a concurrent-generation limit or a cold backend; see concurrency test.
## 1+4. Idle timer on 1.5 (c_idle.py, 5 parallel sessions, logs C-idle-<mode>.txt/.jsonl)
Event `session.idle_timeout {"seconds_idle": 300}`, then the server closes with code 1000, reason "Idle timeout: no user speech for 300s".
| mode | last activity | timeout at | gap |
|-|-|-|-|
| none (one text turn, then nothing) | response.done 5.2 s | 305.2 | 300.0 |
| text item every 120 s, no response.create | response.done 5.2 | 305.2 | 300.0 → typed items do NOT reset |
| no-op session.update every 60 s | response.done 5.1 | 305.1 | 300.0 → updates do NOT reset |
| continuous silence appends, real speech once at 140 s | speech_stopped 146.3 / response.done 146.7 | 446.7 | 300.0 from that turn → silence does NOT reset, speech does |
| audio answer of 67.9 s (generated by 12.7, playback would end ~73.3) | | 383.0 | timer started at ~83.0 |
- So the timer restarts when a turn finishes (user speech or response). Assistant audio holds the timer until about the end of its *playback*, not until response.done: it started ~10 s after my estimated playback end (12.7 + 67.9 = 80.6 if the server counts from generation end). **A phone caller who is listening to a long answer is safe**; the 5 min only starts after the voice stops talking.
- A caller who just sits silent gets cut off 5 min after the last turn. Twilio line noise below the VAD threshold won't help. Keepalive (inferred from the "none" row, where a response.done started the timer): an injected text item + `response.create` every <5 min should reset it; typed items alone don't.
## 2. max_duration_sec
- Not disclosed upfront: session.created keys are audio,id,instructions,max_output_tokens,model,object,output_modalities,temperature,tool_choice,tools,truncation,type. No other event carries it.
- Long session (c_idle.py maxdur: q.wav speech every 240 s keeps idle timer alive, text out) started 20:47:25, stops itself at 31 min (~21:18:30). Result appended below when done.
## 5. Concurrency (20:56-20:58 EDT, main key; my maxdur session was also open, other testers possibly)
- Sockets/sessions: 25 opened one at a time, all got session.created, all alive at the end, closed. No session cap found at 25 (+1 open).
- **Simultaneous generations are the real limit on 1.5: ~2 per key.** c_gen.py N = N sessions fire response.create at the same instant: N=1 ok; N=2 ok,ok (2 runs); N=3 2 ok + 1 upstream_error (2 runs); N=4 0/4 then 2/4 ok; N=8 1/8 ok. Failure = `error {type: server_error, code: upstream_error}` + response.done, socket stays open.
- 1.0 same test: N=4 and N=8 all ok.
- Per key, not global: 4 at once split 2+2 across BOSON_API_KEY and BOSON_API_KEY_2 → 4/4 ok, twice.
- This explains the phase 2 side note (6 parallel first turns, 4 failed) and probably the 1-in-4 "turn never answered" flake in INDEX if another session on the key was generating. Design implication: one key per concurrent live call on 1.5; retry the response on upstream_error.
- RESULT: no `session.max_duration_reached` within 31 min (1981 s) on 1.5. Speech every 240 s kept it alive (8 speech turns, all answered, idle timer never fired). The cap is ≥31 min, if there is one. Stopped by the client at 21:20 EDT.
