# Higgs Realtime 1.5 preview: what it can do, where the frontier APIs beat it, and the phone-in design

Probed Oct 23 2026 (evening, Toronto) by a team of five agents, one topic each, every test run on both
`higgs-realtime` (1.0) and `higgs-realtime-1.5-preview`. Raw tables, scripts and event logs: `probe/r15/`
(`A-tools.md` tool calls, `B-latency.md` latency and turns, `C-session.md` session mechanics and formats,
`D-compare.md` frontier comparison, `E-twilio.md` phone-in build spec). Evidence tags below: [A] [B] [C] [D] [E].
Every result the team set out to get is in; §12 lists what was not attempted.

## 1. Verdict

- 1.5 is live on both keys, on the same endpoint, with the same event names, formats and limits as 1.0. Switching is `connect(model="higgs-realtime-1.5-preview")`. [C]
- Unloaded, it is ~70 ms slower than 1.0 and otherwise indistinguishable in latency. Most of what a caller waits for is the silence detector, not the model. [B]
- It is **less reliable at using tools**: on the first turn it says "I've handed that off" without calling `delegate_task` in 7/24 runs (29%; 1.0: 0/4). The layer's NUDGE recovers it **12/12** when it fires, but the `CLAIM` regex that triggers it misses 3 of 15 fake phrasings. Fixable in the layer at ~+1.5 s on a quarter of task turns. [A]
- **About 2 simultaneous generations per API key.** A third concurrent `response.create` fails with `upstream_error`. 1.0 takes 8 at once. [C]
- The async tool protocol our layer depends on works on 1.5 exactly as on 1.0: a call stays open across turns, a result returned 30 s later is spoken and remembered. [A]

## 2. Latency [B]

All numbers median seconds, one TTS clip (`probe/r15/q.wav`), key 2, runs alternated 1.0/1.5.

| What the caller experiences | 1.0 | 1.5 |
|---|---|---|
| End of speech → first reply audio (default `server_vad`) | 0.92 | 1.00 |
| … of which the silence wait (`speech_stopped`) | 0.56 | 0.56 |
| … of which model + TTS (`speech_stopped` → first audio) | 0.36 [0.07–0.56] | 0.44 [0.41–0.50] |
| End of speech → first audio with `silence_duration_ms: 400` | – | 0.85 |
| Manual turn: `commit` → first audio (`turn_detection: null`) | 0.47 | 0.52 |
| Text mode: `response.create` → first token | 0.11 | 0.18 |
| Text mode: → `response.done` | 0.51 | 0.40 |

- 3000 chars of instructions: no measurable effect (±40 ms). Audio is generated ~8× real time (12 s of speech lands in 1.3 s), so `response.done` means "finished generating", never "finished speaking".
- **Under load 1.5 is a different model.** First-token times fall into bands of ~0.16 / 0.6 / 1.4 s regardless of tools, prompt length, temperature or key; `upstream_error` arrives at ~1.3 s (looks like an upstream timeout plus retry). Three sessions generating in parallel: ~50% of responses failed; sequential: 0/24. [A][C]
- VAD knobs on 1.5: `silence_duration_ms` 400 is the sweet spot (−70 ms, no early cuts); 200 cuts mid-sentence every run; `threshold` 0.55 changes nothing on clean input; `semantic_vad` is accepted but commits at pauses like 200 ms (once answered "Hello!" after the first word).
- The 1-in-4 "turn never ended" flake seen in the very first probe did not reproduce in 22 runs per model. Cause unknown.

## 3. Asynchrony and tool calls [A]

Text mode, `delegate_task` declared as in `higgslive.py`, request "make groceries.txt", then a bare ack, two unrelated turns, the output at 30 s, a recall question.

| | 1.0 | 1.5 |
|---|---|---|
| Call stays open across 2 unrelated turns, no error, no re-call | 4/4 | 6/6 |
| Bare `response.create` after the call gives a natural ack, no re-greeting | 3/4 (4th re-called) | 3/6 (3 were `upstream_error`) |
| Output returned at 30 s used in the next reply / recalled later | 4/4 / 4/4 | 6/6 / 4/6 (2 errors) |
| First turn: tool actually called (clean runs, one reply at a time) | 4/4 | 17/24 shipped prompt; 19/24 with a stronger "never claim" line (within noise, not the fix) |
| NUDGE (sent as `_handle` does) followed by a correct call | – | 12/12 |
| `CLAIM` regex catches the fake phrasing | – | 12/15 (misses "handed that task off", "handed off the task", "handing off the request") |
| Speaks a preamble in the same response as the call | 0/4 (empty text) | 2/2 text, 3/3 audio ("I'll get that file set up") |
| From audio: called the tool on the first turn | 3/3 (double-called 3/3) | 3/3, no fake claim |
| Two calls in flight, outputs returned in reverse order: each matched to the right task and recalled | 3/3 | 3/3 |
| …but with only the second result in, the model also said the FIRST task was done | 1/3 | 2/3 |
| Extra near-duplicate `delegate_task` calls for one request | **9/12** (2–3 calls); 4/12 with "call it once" in the description | 0/2 |

- **Double utterance on 1.5:** its own preamble plus the layer's bare ack. Fix: skip the ack when the call response already carried text.
- **Fake claim on 1.5 is fixable in the layer:** loosen `CLAIM` to `\bhand(ing|ed)\b[^.]{0,20}\boff\b` (covers all 15 observed phrasings) and keep the existing one-shot NUDGE; the strong instruction line alone is not the fix (5/24 vs 7/24). Earlier phase-2 error rates were key-level collisions (see §2), not model behaviour; the clean rerun had 0 errors in 48+12 responses.
- **False "done" on the other pending task:** when two tasks are open and only the second result lands, the model tends to announce both as finished. Mitigation to test: keep a `[progress] <task> still running` note in context (the layer's thinking channel) until each result arrives.
- **1.0 over-calls** and this affects today's demo: the layer emits one `session.delegation.created` per call, so the bridge would spawn 2–3 agent jobs for one request. Fix: open only the first call per response, return a dummy output to the extras. This contradicts the clean 3/3 recorded in `IDEAS.md` (Oct 23 21:30), which had N=3.
- Server tools: the function name `delegate` (and `web_search`) is reserved by the server; ours is `delegate_task`. After a server tool output the server starts the next response by itself. `web_search` runs server-side on 1.5 and works (~0.5 s, excerpts with URLs; 1.5 grounded its answer in the excerpt, 1.0 appeared to invent a price, N=1).
- 1.5 mentions the open task in unrelated answers ("…while the file is being created"); 1.0 never did. `call_id` is 16 hex on 1.5 vs 32 on 1.0 (different serving stack). `usage` is populated on both models now (tokens + `cached_tokens`); 1.5 renders the same prompt ~120 tokens larger.
- **A pending call survives a barge-in** on both models (audio, 3/3 each, 0 errors): the ack response is cancelled at `speech_started`, nothing references the `call_id`, and the output sent 30 s later is accepted, spoken and recalled 3/3. `conversation.item.retrieve` shows the `function_call` item as `completed` throughout, which only means it finished generating: the server exposes nothing about a call awaiting output, so the layer's `_open` set is the only record. Gemini documents the opposite (pending calls cancelled on interrupt). [A]

## 4. Turn-taking and barge-in [B]

- **Manual turns work** (corrects an earlier note): `turn_detection: null`, stream audio, `input_audio_buffer.commit` → `committed` + `item.added` in ~0.1 s → bare `response.create` → first audio in ~0.5 s. 0.4 s faster than server VAD. This is the path for push-to-talk, a phone keypad, or a client-side VAD.
- **Barge-in event order** (both models, N=4 each): `speech_started` fires ~0.26 s after the interruption begins; `response.done` with status `cancelled` arrives 0–20 ms *before* it, with the last audio delta. The client is holding ~5–6 s of unplayed audio at that moment and must flush on either event.
- The server sends no `conversation.item.truncated`. `conversation.item.retrieve` shows the stored assistant text cut to `"The capital<|INTERRUPTED|>"` (8/8), i.e. where the server *assumes* real-time playback from the first delta had reached. `output_audio_transcript.done` still carries the full text, so it is not "what the user heard". The next reply showed no awareness of being cut off (weak test).
- Client `response.cancel`: cancelled `done` in 0.04–0.11 s; otherwise identical to a barge-in.
- **Gotcha:** every premature commit (200 ms VAD, `semantic_vad`) emits `response.created` that never gets a `response.done`. `higgslive.py` sets `in_flight` on `created` and clears it on `done`, so it would stick.
- Full duplex as advertised on the slide ("listens while it talks, no silence detector") is **not what the API exposes**: turns still come from `server_vad` or a client commit; nothing answers without one.

## 5. Session mechanics and formats [C]

- Handshake (both models): the server sends nothing on connect; `session.created` is the reply to the first `session.update` and echoes the applied config; later updates get `session.updated`. Two updates sent before `session.created` both apply in order and merge. A client that waits for `session.created` before its first update hangs (`higgslive.py` does it right).
- Mid-call `session.update` works: instructions change applies next turn (French → Spanish); voice change applies (default → jake, median pitch 215 → 119 Hz); partial updates merge; an invalid voice returns `invalid_request_error` and the call continues on old settings.
- Idle timeout: `session.idle_timeout {seconds_idle: 300}` then close 1000 "no user speech for 300s". The clock restarts when a **turn** ends; assistant audio holds it until about the end of its real-time playback (a 68 s answer, generated in 12.7 s, timed out at 383 s). Silence appends, text items without a response and no-op updates do **not** reset it. Keepalive (inferred, untested): inject a text item + `response.create`.
- `max_duration_sec`: not disclosed in any event up front, and **no `session.max_duration_reached` fired in 1981 s (33 min)** on 1.5 with a short speech turn every 4 min (8/8 answered, idle timer never fired; closed by the tester at 21:20). So the cap is ≥31 min; a long phone call works as long as the caller speaks at least once every 5 min. [C]
- Formats (both models): `audio/pcmu` 8 kHz μ-law works natively **in and out** (q.wav as μ-law transcribed word for word; output deltas 400 B = 50 ms of real μ-law). pcm 8/16/24 k and opus (one ~48 B packet per delta) work. **48 kHz on both input and output fails on 1.5 only** (`upstream_error` right after commit, 2/2; mixed 48/24 fine; 1.0 fine).
- `/v1/models`: the 1.5 entry is identical to 1.0's (owned_by vllm, max_model_len 32768, metadata null). New ids on the list: `higgs-realtime-tts`, `higgs-tts-mps`, `qwen3-forced-aligner-0.6b`.

## 6. "Multiple channels?" [C]

Three readings, three answers:
- **Two sockets on one session:** no. `?session=`, `?session_id=`, and `X-Session-Id` / `Session-Id` / `OpenAI-Session` headers all open a fresh session (new 8-hex id, no memory of the first). There is no attach or observer mechanism. The agent therefore reaches the call only through the bridge process (inbox/outbox), as now.
- **Many sessions per key:** 25 idle sockets opened fine (no cap found), but only ~2 can **generate** at the same instant on 1.5 (3 → 1 fails, 4 → 0–2 ok, 8 → 1 ok; per key, since 2+2 across both keys passed 4/4). 1.0 passes 8/8. Design rule: one key per live 1.5 call; retry the response on `upstream_error`.
- **Stereo / multi-channel audio:** no. `channels: 2` is silently dropped from the echoed config; mono only.

## 7. Speculative delegation: can the agent start before the user finishes talking?

The question: when the user is mid-sentence and the task is already clear, can work begin before the voice model's turn, so the result lands sooner?

- **The model does not act before `speech_stopped`** on either model: a 12 s rambling spoken request with the task clear by second 3 produced no `response.*` and no `function_call` before the turn ended (N=3 per model). The slide's "calls tools without stopping" is not visible in the API. `speech_stopped` → `function_call`: 0.55 s on 1.5, 0.9 s on 1.0; the arguments arrive in one delta. [A]
- **No partial input transcripts** on either model: zero `input_audio_transcription.delta` events; `.completed` arrives ~0.7 s after `speech_stopped`, *after* the function call. So the call itself is the first signal the layer gets about the task. [A]
- **What is available today:**
  - *Manual commit* saves 0.4 s per turn on both models. A client-side VAD (or push-to-talk, or a phone key) that commits the moment the user stops beats the server's 0.56 s silence wait. [B]
  - *A side STT channel:* fork the mic into a second, transcription-only session (`higgs-stt-3.1`, cents per minute). It would stream text we control while the main session listens; the bridge could read intent early and pre-warm the agent (spawn the headless session, load the project) before the voice model decides. Not probed this round; cost is a second socket per call, which the concurrency limit allows (sockets are not limited, generations are, and STT is not a generation on the realtime model).
  - *Pre-warming* the backend at call start (already the first north-star item in `IDEAS.md`) removes agent startup from the critical path regardless of when the task is known.
- Conclusion: the agent cannot start early from Higgs's own signals today. The wins available are pre-warming the backend at call start, a client-side commit (−0.4 s per turn), and a side STT channel if early intent is worth a second socket. Sequential decisions would ride on the side channel.

## 8. Where the frontier live APIs beat Higgs, and which gaps we fill [D]

Full 26-row matrix with sources in `probe/r15/D-compare.md` (OpenAI Realtime `gpt-realtime-2.1`, GPT-Live `gpt-live-1`, Gemini Live `gemini-3.8-live`, Higgs 1.0, Higgs 1.5). One caveat from D: two openai.com blog posts returned 403, so gpt-realtime's async function calling is from memory and marked unverified there.

**Gaps our layer fills (the pitch):**
1. **Delegation to a backend that acts.** GPT-Live hands work to a Responses backend with hosted tools or to the client; Higgs 1.0 has the stub, 1.5's background model (per the slide) only thinks and is not even reachable yet. Ours works on 1.0 and 1.5 today on Higgs's own async tool protocol, and the call carries the task text, which GPT-Live's client mode does not. [A]
2. **Async scheduling semantics.** Gemini documents `NON_BLOCKING` with `SILENT` / `WHEN_IDLE` / `INTERRUPT`; GPT-Live has thinking / commentary / instructions. Higgs documents none of it. Our three channels map onto both.
3. **Hosted tools.** GPT-Live's backend has web/file search, code interpreter, shell, MCP; Higgs has `web_search` only (`mcp` is accepted but inert). The local coding agent is the tool host, with the user's own permissions and project.
4. **Barge-in truncation on WebSocket.** OpenAI's WebRTC/SIP truncates server-side; on Higgs-WS the client must flush and may `conversation.item.truncate`. The layer flushes on `speech_started`; it should also flush on a cancelled `response.done` (arrives first) and could truncate at the last played mark once Twilio gives ground truth. [B][E]
5. **The duplicate-call guard.** 1.0 fires 2–3 near-duplicate calls for one request 9/12 times; no frontier API documents this failure, and the fix is ours (first call only). Not shipped yet. [A]

**Gaps we fill partly:**
6. **1.5's tool skipping.** 29% fake claims on the first task turn; the layer's NUDGE recovers 12/12, so the behaviour is fixable at the cost of ~1.5 s on those turns once the `CLAIM` regex is loosened (it misses 3/15 phrasings today). A stronger instruction line alone does not fix it (21% vs 29%). [A]
7. **Long calls.** Gemini has resumption handles (2 h) and `GoAway`; GPT-Live forks stored sessions and hot-swaps engines at 90% context. Higgs: 32k context, 300 s idle timeout, undisclosed duration cap, no resume. The client can replay text + `function_call` items into a new session, keep open delegations alive (the backend is ours), and keep the idle timer alive with a text item + `response.create`. [C]
8. **Partial transcripts while the user speaks.** OpenAI streams deltas (GPT-Live with ms timestamps). Higgs: completed only. Fill with a side STT channel (§7).
9. **Out-of-band responses.** OpenAI's `conversation: "none"` runs a side response without touching the conversation. On Higgs any `response.create` body triggers the greet-from-scratch bug (`conversation: "none"` alone is untested). Fill with the backend agent or a separate text session.
10. **Telephony.** OpenAI has native SIP in/out, DTMF, refer/hang-up. Higgs is WebSocket only, but takes μ-law 8 kHz natively, so a Twilio Media Streams bridge works with no transcoding (§9). DTMF and transfer come from Twilio's APIs, not Higgs. [C][E]
11. **Reliability under load.** Frontier APIs publish tiers and `rate_limits.updated`; Higgs publishes nothing and 1.5 degrades at 3 concurrent generations. Fill operationally: one key per live call, retry on `upstream_error`. [C]
12. **Turn latency.** Nobody publishes numbers. Ours: `silence_duration_ms: 400` (−70 ms) or client VAD + manual commit (−0.4 s). [B]
13. **Image input.** OpenAI takes images, Gemini video; Higgs audio + text. The backend agent can look at files/screens and return a text hint.

**Gaps we cannot fill:**
14. **Full duplex and backchannels.** GPT-Live listens while speaking and backchannels without creating messages. 1.5's API still runs on `server_vad`; nothing answers without a commit. Position honestly: barge-in only. [B]
15. **A stronger background model inside the voice session.** GPT-Live's `gpt-6-luna/sol`, Gemini's extended-thinking Live model. Boson's is announced, not reachable. [A]
16. **Affective / proactive audio.** Gemini adapts to tone and can decline to answer side talk; Higgs steers style only via instructions and ignores `create_response: false`.
17. **Native SIP/WebRTC/DTMF and server-truth usage/rate limits.**

**Where Higgs 1.5 is behind 1.0 today:** tool skipping; ~2 generations per key; ~50% errors at 3 parallel sessions; +70–80 ms; 48 k in+out broken; the double utterance. [A][B][C]

**Where Higgs beats the frontier APIs:** price (≈$0.016/min audio vs $0.05 GPT-Live, $0.023 Gemini); async tool calls on the voice model itself, undocumented but real, and they survive barge-in (Gemini cancels them); opus and μ-law and 8–48 k PCM; cloned voices; built-in `web_search`; manual turns at ~0.5 s. [D]


## 9. Phone in to your coding sessions (Twilio) [E]

Full build spec in `probe/r15/E-twilio.md`, cut to what one teammate can build in ~3 hours.

```
phone ─ Twilio ─ GET https://HOST/voice ─┐   cloudflared quick tunnel → localhost:PORT
                 wss://HOST/s/<secret> ──┴─> bridge.py --phone PORT  (one process, one call at a time)
                                               ├─ websockets.serve(handler, process_request=twiml)  # HTTP + WS on one port
                                               ├─ per call: higgslive.connect(rate=8000, codec="pcmu", playback="client")
                                               └─ backend() unchanged; results outlive the call (HELD → callback)
```

- **Audio:** Twilio's 160 B / 20 ms μ-law frames go straight into `input_audio_buffer.append`; Higgs's 400 B μ-law deltas go straight back as Twilio `media`. No resampling, no μ-law table. [C]
- **`higgslive.py`, ~6 lines:** `connect(codec="pcm"|"pcmu")`, a bytes-per-second constant replacing `rate*2` at the two hardcoded spots (format at line 97, playback estimate at line 182), and a `playback="client"` mode: each delta marks playback as ongoing, and a new `conn.playback_done(n)` sets `spk_until = now` only for the latest delta number. The bridge sends a Twilio `mark` per delta and calls `playback_done` on each echo, so the layer's 1 s "speak the result" beat counts from when the caller actually stopped hearing audio instead of a byte estimate. On barge-in the bridge sends `clear`; Twilio echoes all pending marks, which resets the state for free. Mic and headless modes unchanged.
- **`bridge.py`:** `main()` splits into `call(io, seed)` plus a mic adapter and a phone adapter; only two sinks in `events()` change (play → `io.play`, clear → `io.clear`). Backends, `say|note`, the opener and the `/call` skill are reused. The Twilio webhook is served as GET by the websockets server's `process_request` (set `VoiceMethod=GET` with the `VoiceUrl`; swap `Content-Type` to `text/xml`).
- **Auth:** `X-Twilio-Signature` check → `From` allowlist → `<Gather>` 4-digit PIN → per-run secret WebSocket path. Higgs opens only after the PIN. A second call while one is live gets "Busy". Nothing from a phone pushes, deletes or reads secrets aloud.
- **Hang up and call back:** results go through one `deliver()`: spoken if a call is live, else appended to `HELD` (mirrored in `~/.higgs/held.jsonl`) and the bridge dials the verified number (`POST Calls.json`). If Higgs closes under a live caller (idle timeout or duration cap), a REST redirect has Twilio say "I'll call you back when it's done" and hang up; delegations keep running in the process. Any call while `HELD` is non-empty opens with "Calling about: N tasks finished" via the existing seed path. No retries.
- **Reaching a busy interactive session:** a `PostToolUse` hook runs `python3 bridge.py hook` (stdlib only, handled before `import higgslive`); it acts only when `cwd` matches `~/.higgs/hook.cwd` (written by `/call`), reads new inbox lines from a byte offset, and returns `hookSpecificOutput.additionalContext` telling the agent to reply with `bridge.py note|say <id>`. Idle sessions keep the `/call` wait loop; tasks are deduped by id. Codex has no equivalent hook; redirecting a busy Codex task goes through the headless backend.
- **Idle timer on the phone:** a caller listening to a long answer is safe (assistant playback holds the timer); a caller who stays silent is cut off 300 s after the last turn. Twilio line noise under the VAD threshold does not count as speech. [C]
- **Demo beat (Track 3):** at the laptop: "refactor the parser and run the full suite", walk away → call in, PIN, "how's it going?" answered from progress notes → interrupt mid-sentence: "skip the slow tests, fix the tokenizer first" (`clear` cuts Twilio's buffer; the redirect lands via the hook) → "call me when it's done", hang up → the phone rings: "Calling about: tests are green, the fix is on a branch."
- **Build order:** layer `codec` + `playback="client"` + self-check (20 min) → `--phone`: server, TwiML, tunnel, VoiceUrl, passthrough, `mark`/`clear` (75) → auth (25) → `deliver`/`HELD`/callback (35) → hook + SKILL.md step (25).
- **Later:** multi-session routing (`~/.higgs/sessions/<name>/`, DTMF digit or name match, a voice `switch_session` tool), `conversation.item.truncate` at the last echoed mark, named tunnel, one-shot WS tokens, "press 1 to confirm" for destructive steps, silent mid-call reconnect instead of hang-up-and-call-back.
- **Open for the builder:** does Twilio accept the TwiML from websockets' `respond()`; does a trial account's "press any key" preamble play before the `<Gather>`; VAD at 0.85 on real phone noise (all probes used a clean clip). Duration cap is ≥31 min [C], so §3 step 2 of the spec (hang up on `max_duration_reached`) fires rarely if ever; the idle timeout is the one that matters.

## 10. Action items for the layer (1–3 shipped Oct 23 ~22:00, verified headless on both models; the rest open)

1. ✅ **Open only the first `delegate_task` call per response.** Changes today's 1.0 demo (9/12 responses over-call). Whether the extras should get an immediate dummy output or simply stay open is untested; phase 1 showed unanswered calls stay open for the whole session with no error. [A]
2. ✅ **Loosen `CLAIM`** to `\bhand(ing|ed)\b[^.]{0,20}\boff\b` so the NUDGE fires on every observed fake phrasing (it recovers 12/12 on 1.5). [A]
3. ✅ **Skip the bare ack `response.create` when the call response already carried text** (1.5's preamble). [A] Verified: 2/2 headless runs on 1.5 speak once.
4. **Keep a progress note per open task** in context until its result lands, to test against the false "both done" when one of two results arrives (2/3 on 1.5, 1/3 on 1.0). [A]
5. **Flush playback on `response.done` status `cancelled`** as well as on `speech_started` (it arrives first). [B]
6. **Guard `in_flight`** against `response.created` without a matching `done` (premature commits). [B]
7. **Retry the response on `upstream_error`**; run one key per live 1.5 call. [C]
8. **`silence_duration_ms: 400`** as the default (−70 ms, no early cuts); keep 0.85 threshold. [B]
9. **Idle keepalive** for a user waiting silently on a long task: text item + `response.create` before 300 s (the "still working" note already does this at `STILL_WORKING_AT`; check it is a response, not just an item). [C]
10. Report to Boson: 48 k in+out `upstream_error` on 1.5; ~2 generations per key. [A][C]

## 11. Corrections to earlier notes

- "1.5 sends no `session.updated`": wrong. `session.created` acks the first update; later updates are acked. [C]
- "`turn_detection: null` never answers": wrong; the probe never committed. Manual turns work and are the fastest path. [B]
- "`usage` is always null": no longer; populated on both models since Oct 23. [A]
- "Higgs tool calls survive barge-in": stated in D's phase 1 from the 1.0 layer's experience, retracted as unproven, then confirmed by A's phase 3 (3/3 per model). It stands, now with evidence.
- `IDEAS.md` "clean 3/3, no re-call" on 1.0: N=3; with N=12, 9 responses over-called. [A]

## 12. Pending

- Not tested this round: `conversation: "none"` alone; the idle keepalive; the progress-note mitigation for the false "done"; a real mic with noise; a real Twilio call.
