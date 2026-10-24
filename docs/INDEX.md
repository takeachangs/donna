# Boson AI docs — local mirror (fetched 2026-10-22)

Grep this folder first: `grep -rn "<term>" docs/`. Every file is plain markdown mirrored
1:1 from https://docs.boson.ai/<path>.md. `openapi.json` is the REST spec (8 paths).
`tutorial/` is boson-ai/Higgs-Realtime-Tutorial (browser voice assistant, parts 0-7).

## Quick facts
- REST base: `https://api.boson.ai/v1`  (OpenAI-compatible; OpenAI SDKs work with `base_url`)
- Realtime WS: `wss://api.boson.ai/v1/realtime` (`?model=higgs-realtime` optional)
- Auth: `Authorization: Bearer $BOSON_API_KEY` (key in ~/.zshrc, prefix `bai-`). Browser clients: mint ephemeral key via `POST /v1/realtime/client_secrets`, connect with subprotocol `bai-client-secret.<key>`.
- Models the key lists (GET /v1/models, 2026-10-22 23:30): higgs-realtime (ctx 32768), higgs-stt-3.1 (ctx 8192), higgs-tts-v3, higgs-avatar, higgs-realtime-tts, higgs-tts-mps, qwen3-forced-aligner-0.6b. (`higgs-avatar-realtime` appeared earlier that day and was removed; it is rejected everywhere.)
  - Undocumented: higgs-realtime-tts, higgs-tts-mps, qwen3-forced-aligner-0.6b. Probe before relying on them.
- REST paths: /v1/audio/speech, /v1/audio/voices[/{voice}], /v1/videos, /v1/videos/{id}, /v1/videos/{id}/content, /v1/videos/stream, /v1/realtime/client_secrets
- Realtime audio: PCM16 mono 24 kHz default (8/16/24/48k), also pcmu 8k and opus. Barge-in: stop local playback on `input_audio_buffer.speech_started`.
- Preset TTS voices: chloe, eleanor, jake, marcus, nora, oliver (or `voice_<id>` from /v1/audio/voices)
- TTS inline tags: `<|emotion:x|>`, `<|style:x|>`, `<|sfx:x|>`, `<|prosody:x|>` — see models/higgs-tts/tags.md

## Where to look
| Need | File |
| --- | --- |
| session.update fields, every client event | api-reference/realtime/client-events.md |
| every server event + payload | api-reference/realtime/server-events.md |
| tool calling flow (realtime) | models/higgs-realtime/guides/tool-calling.md |
| VAD / interruptions | models/higgs-realtime/guides/turn-detection-and-interruptions.md |
| TTS request body, streaming, ref_audio | api-reference/audio/create-a-speech.md |
| emotion/style/sfx tags | models/higgs-tts/tags.md |
| voice cloning | api-reference/audio/create-a-voice.md, models/higgs-tts/voices.md |
| avatar video job + streaming fMP4 | api-reference/videos/*.md, models/higgs-avatar/*.md |
| error codes | api-reference/errors.md |
| delegation layer design (GPT-Live parity mapping, progress channels) | delegation-design.md |
| the delegation layer itself (GPT-Live-shaped API on Higgs) | ../higgslive.py; bridge = ../bridge.py |
| hackathon rules, tracks, judging weights, submission form fields | hackathon.md |
| **Donna and the herd**: the mailbox between the voice and the brain (a Claude Code session): reply kinds and task lifecycle, hook reducer, ring mode, transfer | herd.md |
| **Realtime 1.5 preview: findings, frontier-API gap list, Twilio phone-in design** (Oct 23 team probe; raw in `../probe/r15/`) | realtime-1.5.md |
| LIVE avatar (lip-sync in a LiveKit room, shipped Oct 23 evening) | models/higgs-avatar/realtime-sessions.md, api-reference/avatar-realtime/*.md |
| server-side web_search tool in Realtime (shipped Oct 23 evening) | models/higgs-realtime/guides/tool-calling.md#web-search |
| GPT-Live infra post: async delegation path, pre-warm backend, time-to-useful | gpt-live-architecture.md |
| GPT-Live infra post, full text (pre-warm, WARP, handoff/compaction, speculative vs authoritative turns) | gpt-live-post.md |
| browser starter (token endpoint → mic → tools) | tutorial/part-0.md … part-5.md |
| Pipecat / LiveKit server agents | tutorial/part-6.md, part-7.md |

## All pages
- `overview.md` — Welcome to Boson AI: Choose the Higgs API for live conversation, generated speech, or talking-avatar video.
- `set-up-your-account.md` — Set up your account: Create a Boson AI account, get an API key, claim your free trial credit, and make your first call.
- `free-trial-credit.md` — Free trial credit: What the Boson AI free trial credit covers, how to claim it, and what happens when it runs out.
- `authentication.md` — Authentication: Authenticate Boson API requests with a Bearer token.
- `pricing.md` — Pricing: Usage-based pricing for Higgs Realtime, Higgs TTS 3, and Higgs Avatar.
- `account-billing/payment-and-credits.md` — Payment & credits: How Boson AI billing works: prepaid credits, payment methods, auto-reload, and invoices.
- `account-billing/usage-and-limits.md` — Usage & limits: Track spend, set a monthly cap, and understand what happens when a limit is reached.
- `models/higgs-realtime/overview.md` — Overview: Build realtime voice assistants over WebSocket with streaming audio, text, turn detection, and tool calling.
- `models/higgs-realtime/quickstart.md` — Quickstart: Every step from a fresh account to a working Higgs Realtime voice assistant.
- `models/higgs-realtime/guides/connections-and-sessions.md` — Connections and sessions: Connect over WebSocket, authenticate safely, configure a session, and choose Realtime and transcription models.
- `models/higgs-realtime/guides/audio-and-voices.md` — Audio and voices: Choose a Realtime voice, audio codec, and sample rate.
- `models/higgs-realtime/guides/turn-detection-and-interruptions.md` — Turn detection and interruptions: Configure automatic or manual turns and keep the conversation aligned during barge-in.
- `models/higgs-realtime/guides/tool-calling.md` — Tool use: Declare functions, execute tool calls in your application, return results, and continue the Realtime response.
- `models/higgs-realtime/migrate-an-existing-integration.md` — Migrate an existing integration: Move an OpenAI Realtime integration to Higgs Realtime and review the protocol compatibility differences.
- `models/higgs-realtime/integrations/livekit.md` — LiveKit: LiveKit support status for Higgs Realtime, and what to use in the meantime.
- `models/higgs-realtime/integrations/pipecat.md` — Pipecat: Use Higgs Realtime as a speech-to-speech service in a Pipecat pipeline.
- `models/higgs-tts/overview.md` — Overview: Chat-native text-to-speech with streaming, 100 languages, instant voice cloning, and inline emotion and style control.
- `models/higgs-tts/voices.md` — Voices: Use preset voices, reference audio, or reusable custom voices with Higgs TTS 3.
- `models/higgs-tts/languages.md` — Languages: Higgs TTS 3 supports 102 languages with single-digit WER/CER.
- `models/higgs-tts/tags.md` — Tags: Inline control tokens that shape emotion, style, prosody, and sound effects inside the input text.
- `models/higgs-avatar/overview.md` — Overview: Generate talking-head video from a still image and a driving voice or text.
- `models/higgs-avatar/input-options.md` — Inputs and limits: Choose audio or text input, upload local assets, and check Higgs Avatar sizes, limits, and common errors.
- `models/higgs-avatar/streaming-video.md` — Streaming video: Receive fragmented MP4 from Higgs Avatar so playback can begin before generation finishes.
- `api-reference/realtime/overview.md` — Overview: Connect to Higgs Realtime and navigate the REST and WebSocket protocol reference.
- `api-reference/realtime/client-secrets.md` — Create a client secret: Mint a short-lived credential for browser and client-side Higgs Realtime connections.
- `api-reference/realtime/client-events.md` — Client events: Configure a Realtime session, provide input, manage conversation items, and control responses.
- `api-reference/realtime/server-events.md` — Server events: Handle session state, input audio, streamed responses, tool calls, errors, and lifecycle events.
- `api-reference/audio/create-a-speech.md` — Create a speech: Generate speech audio from text. Returns an audio file, or a stream of raw PCM chunks when `stream` is `true`. The body may be JSON or `multipart/form-data` — the latter lets you upload `ref_audio` as a raw file instead of base64-encoding it.
- `api-reference/audio/create-a-voice.md` — Create a voice: Register a reusable reference voice for cloning. Identical audio re-registered under the same API key returns the existing voice. Pass the returned `voice` ID to the `voice` field of `POST /v1/audio/speech` instead of sending `ref_audio` on every request.
- `api-reference/audio/list-voices.md` — List voices: List the reference voices registered under your API key.
- `api-reference/audio/get-a-voice.md` — Get a voice: Fetch a single reference voice by ID.
- `api-reference/audio/delete-a-voice.md` — Delete a voice: Delete one of your own reference voices. The reference audio is removed, so the voice stops working on /v1/audio/speech and no longer appears in the voice list. Preset voices cannot be deleted. Because the ID is derived from the audio itself, re-creating the voice with the same `ref_audio` returns t…
- `api-reference/videos/create-a-video.md` — Create a video: Create an avatar talking-head video (async). Returns the Video object with `status: "queued"`; poll `GET /v1/videos/{video_id}` and download the rendered MP4 from `GET /v1/videos/{video_id}/content`. Provide a reference image plus exactly one driving input — `input` (audio-to-video) or `input_tts` (…
- `api-reference/videos/retrieve-a-video.md` — Retrieve a video: Retrieve the Video object (status / progress). Always JSON — the rendered MP4 is downloaded from `GET /v1/videos/{video_id}/content`.
- `api-reference/videos/download-content.md` — Download content: Download the rendered video. Returns the MP4 bytes (`variant=video`, the default). `404` until the video is `completed`.
- `api-reference/videos/create-a-video-streaming.md` — Create a video (streaming): Same request body as `POST /v1/videos`, but the response body IS the live fragmented-MP4 (fMP4) byte stream — frames arrive as they are generated, so playback can start before the clip is complete. The video id rides back in the `X-Video-Id` header; the full MP4 is stored too, so a later `GET /v1/vi…
- `api-reference/errors.md` — Common error types: HTTP statuses, the error body shape, and every error code with its fix.

## Tutorial
- `tutorial/README.md` — parts overview, checkpoints, setup (npm install, cp .env.example .env, npm run dev)
- `tutorial/part-0.md` — Part 0 — Auth and the token endpoint
- `tutorial/part-1.md` — Part 1 — First connection
- `tutorial/part-2.md` — Part 2 — Live microphone and interruptions
- `tutorial/part-3.md` — Part 3 — Transcript state
- `tutorial/part-4.md` — Part 4 — Tool calling
- `tutorial/part-5.md` — Part 5 — Prompting
- `tutorial/part-6.md` — Part 6 — A voice agent with Pipecat
- `tutorial/part-7.md` — Part 7 — A voice agent with LiveKit Agents

## Gotchas found by probing (Oct 23)
- Server intercepts function tools by NAME: `delegate` and `web_search` run server-side (executor:"server") whatever schema you declare; `_delegate(reason)` is a stub ("delegation service is not configured"). `tool_choice` none/required/named all ignored or broken: only `auto`. Unknown session fields are silently ignored (no validation signal).
- Docs changed Oct 23 evening: `server_vad.threshold` default is now 0.85 (was 0.55); `function_call` items carry `executor: "client"|"server"` — never send function_call_output for server ones (web_search). Realtime avatar sessions exist now (`POST /v1/avatar/sessions`, LiveKit Cloud only, model higgs-avatar).
- Context window: `higgs-realtime` max_model_len = 32768 (from GET /v1/models; not in docs). Server summarizes old items in the background (`truncation: "auto"`, event `conversation.context.summarized`). `usage` on responses was null on Oct 22; since Oct 23 it carries input/output/total tokens + `cached_tokens` on both models. Session caps: 5-min idle timeout (`session.idle_timeout`) and undocumented wall-clock cap (`session.max_duration_reached`, carries max_duration_sec).
- Never name a function tool `delegate`: the server reserves it for a server-side tool of its own. The call comes back as `function_call` with `executor: "server"`, arguments gain a `reason` field, and the server answers "delegation service not configured". It worked for a few hours on Oct 23 between deployments, then broke again. Boson evidently has server-side delegation in progress — ask. We use `delegate_task`.
- `higgs-realtime-1.5-preview` (probed Oct 23, team of 5, details in `probe/r15/*.md` and `docs/realtime-1.5.md`): live on both keys, same endpoint, same event names, same formats, `/v1/models` entry identical to 1.0 (ctx 32768). Unloaded it is ~70 ms slower than 1.0 (first text 0.18 vs 0.11 s; speech_stopped→first audio 0.44 vs 0.36 s). **Only ~2 simultaneous generations per key**: a third concurrent `response.create` fails with `upstream_error` (socket stays open; retry the response). 1.0 takes 8 at once. **It skips the tool**: on the first turn it says "I've handed that off" without calling `delegate_task` in 7/24 runs (29%; 1.0: 0/4); the layer's NUDGE then recovers it 12/12, but the `CLAIM` regex misses 3/15 phrasings (loosen to `\bhand(ing|ed)\b[^.]{0,20}\boff\b`). Nothing fires before `speech_stopped` and there are no partial transcripts on either model, so the function call is the first signal about the task. With two tasks open, one result landing makes the model call BOTH done (1.5 2/3, 1.0 1/3). It speaks a preamble in the same response as the call (1.0 returns empty text), so the layer's bare ack makes it speak twice. 48 kHz on BOTH input and output fails on 1.5 only; 24 k is fine. `_delegate` is still the instant stub (no background model reachable); `web_search` still runs server-side and works.
- Handshake (both models): the server sends NOTHING on connect; `session.created` is the reply to the FIRST `session.update` and echoes the applied config; later updates get `session.updated`; two updates sent before `session.created` both apply in order. Mid-call instruction and voice updates work next turn; partial updates merge; an invalid voice returns `invalid_request_error` and the call continues. A second socket cannot attach to a session (`?session=`, headers all open a fresh one). Audio is mono (`channels: 2` silently dropped).
- Audio formats (both models): `audio/pcmu` 8 kHz μ-law works natively IN and OUT (Twilio Media Streams frames pass straight through; output deltas 400 B = 50 ms), pcm 8/16/24 k and opus work.
- Manual turns WORK: `turn_detection: null`, stream audio, `input_audio_buffer.commit` (→ `committed` + `item.added` in ~0.1 s), bare `response.create` → first audio in ~0.5 s. That is 0.4 s faster than server VAD (caller wait 0.92 s, of which 0.56 s is the silence wait). `server_vad.silence_duration_ms: 400` saves 70 ms with no early cuts; 200 cuts mid-sentence; `semantic_vad` commits at pauses like 200 ms. **Premature commits emit `response.created` with NO matching `response.done`** (state-tracking leak).
- Barge-in (both models): `response.done` status `cancelled` arrives 0–20 ms BEFORE `input_audio_buffer.speech_started` (~0.26 s after the user starts); the client is holding ~5 s of unplayed audio by then and must flush it. No `conversation.item.truncated` is sent; the stored assistant text is cut at the point the server ASSUMES real-time playback reached (`…<|INTERRUPTED|>`), while `output_audio_transcript.done` still has the full text. Audio is generated ~8× real time (12 s of speech in 1.3 s), so `response.done` ≠ finished speaking.
- Idle timeout (`session.idle_timeout`, 300 s, then close 1000): the clock restarts when a TURN ends; assistant audio holds it until about the end of real-time playback; silence appends, text items without a response and no-op `session.update`s do NOT reset it. Keepalive = inject a text item + `response.create`. No `max_duration_reached` fired in 33 min on 1.5 with a speech turn every 4 min.
- Input transcription is OFF unless `audio.input.transcription: {model: "higgs-stt-3.1"}` is set: without it no `conversation.item.input_audio_transcription.completed` ever arrives (Chamber shipped without it; spoken "bye" could not hang up). `response.cancel` sent right at `response.created` drops that response with no `response.done`, and the next response reuses its id. A bare `response.create` after an assistant reply that stays in history fails with 400 "No user input": a retry after `upstream_error` works only if the failed response left no assistant item (found by Chamber's voice harness, Oct 24).
- 1.0 over-calls `delegate_task`: 9/12 single-task requests produced 2–3 near-duplicate parallel calls ("Call it once per user request" in the description cuts it to 4/12). The layer should open only the first call per response.
- Function tool output is accepted as a plain string or a JSON string; both work.
- Model may *claim* to be working without calling a tool; instruct it explicitly never to say so unless it called the tool this turn.
- Tool choice follows the words in a tool's description, even negated ones (Oct 24, `higgs-realtime`, #23): with "never for files, folders or the computer" in `task_status`'s description, "what's in my directory" called `task_status` in 2/6 runs (0/6 without it, 12/12 once the routing was stated positively in `delegate_task`'s prompt). Keep words about other tools' jobs out of a description. When tasks are queued, "what's in this tray" (STT for "directory") reads as the task in-tray.
- Unclear objects and status words (Oct 24, #43, `higgs-realtime`, text mode, `probe/r43/probe.py`, key 2). "Make a diagram of this"-style
  requests with no context: a first-turn `delegate_task` in 1/10, and that one filled the blank ("explains the topic of the user's
  request"; the 09:48 call wrote "how the delegate_task function works", her own tool's name); the rest said "I'm on it" with no call
  or interviewed ("Could you please provide more details…"). MECHANICS "the task is the user's request in their own words… a 'this'
  the call has not explained stays as they said it" + "never ask the user what 'this' is": the call carries their words in 18-19 of 20 (two runs), 0
  invented objects, but on the first turn only 4/20 (12 "I'm on it", 4 interviews), so the GUARD's nudge does the rest (interview
  phrases now count as OFFER, except while an ask is being relayed: "could you tell me…" is how the voice asks; NUDGE says "in their words"). Status words: "how many agents", "the lounge", "any reports", "the office"
  called `task_status` 5/10 → 20/20 once its description named "the agents (workers)… results not told yet" and MECHANICS listed the
  words. "What did I ask you earlier?" went to `task_status` 9/9 even when MECHANICS said `delegate_task` (descriptions win), so the
  status carries the duty period's earlier results. File questions still go to `delegate_task` (6/6); r26 first-turn 12/12.
- `claude -p` headless: pass `--allowedTools` or file tools are denied silently.
- Claude Code hooks (2.1.309, probed Oct 24 for #44): `SubagentStart` carries `session_id` (set), `cwd`, `prompt_id`, `agent_id`,
  `agent_type` and nothing else: no name, no description; those come only from the brain's `PostToolUse(Agent)`, which for a
  background agent fires BEFORE its `SubagentStart` and for a foreground one after its `SubagentStop`, and now carries
  `tool_response.agentId` in both. The brain's live log also has bare `SubagentStop`s (`agent_type` "", no Start, no Agent
  call, no transcript), ~2 s after each of its 6 `Stop`s and once mid-turn: 7 in one 10-minute call, Claude Code's own helpers
  (cause unconfirmed). Counting them as workers put 7 "Agent" rows in the office lounge.
- `response.create` accepts only `instructions`, `input`, `temperature`, `max_output_tokens`, `metadata` as per-response overrides. In practice ANY `response` body (even a valid `instructions` override) made the model reply with a generic greeting; keep `response.create` bare and put steering text in the conversation item instead. Change `tool_choice` via `session.update` mid-session.
- From audio turns the model refuses "open it in the browser"-style requests more readily than from typed text; a rich tool description + a one-shot forced retry (`tool_choice: "required"`) covers it.
- `tool_choice: "required"` is documented but, set at session level (at start or mid-session), the server produced NO response events at all afterwards — no error, just silence until timeout. Avoid it. Named `{"type":"function","name":…}` at session level fails instantly with `upstream_error`. Only `"auto"` works.
- Prompting higgs-realtime as "on a phone call" (no topic given) made it invent an assigned topic ("we're supposed to talk about our favorite foods") and insist on it. State explicitly that there is no set topic.
- Prompt wording vs tool calls (Oct 24, #26, `higgs-realtime`, text mode, `probe/r26/{first,replaces,aside}.py`): an example ack line in the persona ("like \"I'll get the page started\"") made the model SAY it without calling `delegate_task` (first-turn calls 8/12; "I'll get that game started for you."). Without examples, "call delegate_task first, in the same turn; only after the call, one short sentence" plus the verb list "anything to make, open, run, check, find, change, improve or look up" gave 38/42; every miss was "improve the readme", one of them an interview ("could you provide the current content of the README?"). Adding "the agent reads their files… never ask the user for file contents or details yourself": 24/24 (old prompt 29/30; 1.5-preview 18/18). The model copies the words it is given, as with tool descriptions above.
- A boolean tool parameter works on 1.0 and not on 1.5: `delegate_task.replaces` ("true when this request corrects or changes the one you sent just before") was set on 13/14 corrections that produced a call ("actually, make it green", "no wait, I meant…", "sorry, make that dogs") and on 0/10 second tasks ("also count the files"); both misses wrote "replacing the previous request/task" into the task text, which the layer also accepts. `higgs-realtime-1.5-preview` sent `replaces: false` on 4/4 corrections, with no such phrase. The layer closes the replaced call at once with a plain `function_call_output` and no `response.create` (no reply is triggered, no error), then drops that task's late result.
- A `[note]` result attached right before the user's own turn (the hold policy's speech-start path) is skipped when the persona says results "arrive as the tool's output" and "never narrate progress": relayed 2/5 (old prompt 4/5). Stating it ("a result arrives as the tool's output or as a [note] saying an update came in; tell the user in that same reply… answer them first, then give the result") brought it to 6/6 in text and 3/3 in the live scripted ring demo.
- Goodbye while a task is pending (Oct 24, #32, `higgs-realtime`, typed `--text` runs, task left queued): the voice reported the
  task done in 2/4 runs without a rule ("The version flag has been added", and a JSON tool result read aloud,
  `[{"id": "task_1", "status": "completed", …}] The version flag is all set.`; the rehearsal said `[NOTE: task finished: …]`,
  copying the `[note]` result format). Persona line "If a task is still pending, the goodbye says you'll call them back with the
  result; never say or imply it finished" plus a layer guard (`higgslive.fabricated`: a tag or a done claim while a task runs and no
  result went in this turn is dropped unplayed and the voice is told to say the fixed line verbatim): 10/10 closed on the sign-off,
  0 fabricated lines in the transcript; the guard fired 2/10 (both real: "The version flag has been added") and the model repeated the fixed line word for word, sign-off included.
  "You're all set" is a goodbye, not a claim (3 false hits before it was exempted). Five bridges at once on one key: 3/10 goodbye
  responses failed `upstream_error` mid-reply, cut before the sign-off, so the call never closed; two at once: 0/10.
- Transfer (Oct 24, #28, `higgs-realtime`, `tests/fake_donna.py --transfer`): a fresh session per segment is cheap. The
  new socket's `session.created` came 0.25 s after the old segment ended, and it echoes the applied voice at
  `session.audio.output.voice` (how the check proves who is talking: nora → chloe → nora). The worker persona's
  "Hey, it's Maya." opener (a user-role `Say exactly:` note) was said word for word, and so were "Putting Donna back on." and
  "Hey, it's Donna again.". "Who built the quiz?" once got "I'll check who built the quiz for you." with no `delegate_task`
  call; the GUARD did not nudge because `ASKED` had no who-question. It does now (who built/made/did, on the line, put me
  through, talk to). Donna also refused once ("I can't connect you directly, but I can look up Maya's contact details")
  until the persona said putting someone through is a delegation. In the worker's voice, "call delegate_task with their
  words, in the same turn, then say one short thing while you check" still answered first without a call in 5/6 runs (the
  GUARD's nudge recovered them, but 1/6 invented "thirty seconds" first). "Call delegate_task with the user's words first,
  before you say anything; then only a few words, no details, until its answer arrives" gave 9/11 first-turn calls and 0
  invented details. `relay: true` on the worker's session also makes the GUARD treat any question as a request.
- Sign-off: with the persona's "say a one-line goodbye ending with the exact words \"Hanging up now.\"", 1.0 said the literal on every goodbye in 9/9 headless runs (typed "thanks, bye" / "that's all"), sometimes as the whole reply. Idle nudge as a user-role `[note]` + `response.create` at 30 s: answered in ~0.5 s ("Still with me?").
- No echo cancellation (Oct 24, #34, `higgs-realtime`, live call on MacBook Pro Speakers + MacBook Pro Microphone): `noise_reduction: near_field` does not remove the voice's own audio. The mic peaked 0.40–0.64 (of full scale) while the voice played vs 0.07–0.15 for the user's own speech on the same mic; server VAD (threshold 0.85) fired within 1 s of 25/29 replies and 8/32 user transcripts were the voice's own words ("You asked me." after "You asked me to call."), which the model answered, so the call looped. A higher VAD threshold or a client level bar cannot separate an echo three times louder than the user. `bridge.py` sends zeros while the voice is audible (+0.3 s) on that pair (no barge-in there; headphones keep it), and drops a user transcript that began over the voice and copies its last line.
- Repeated lines while a task is pending (Oct 24, #36, `higgs-realtime`, typed turns, `probe/r36/pending.py`: a request, then a new request, a question about the work, "how's it going", small talk; the brain takes each task and stays silent). On main: 13 identical sentences in 10 runs, 10 of them answers to the layer's own "still working" note, which went out once per open delegation (three tasks, three near-identical lines 3 s apart); the live 08:33 call adds a held note attached to the user's turn, which the model answers instead of the user. The model also repeats itself when the same question comes again: with four "how's it going?" in a row it gave back the same status sentence. Dropping that reply unplayed and retrying once with a user-role nudge got new words in 1/10 retries with "[the user said something new; respond to it, delegate if it is a request]" (once it answered "That's great!", reading the bracket as the user's words), 4/13 with "(system) You already said that, word for word…", 6/11 when the nudge quotes the dropped line ("Not played: you already said \"…\" Never say it again."). Most misses repeat another recent line instead.
