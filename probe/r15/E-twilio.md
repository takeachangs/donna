# E — Phone in to your coding sessions (Twilio × higgslive): build spec

Dial a Twilio number, talk to the Claude Code / Codex sessions on the Mac. Higgs is the voice, the agent works, results are
spoken when they land. The phone takes the place of the mic in today's `bridge.py`. Phase 2: shortened to what one teammate can build in
~3 hours; everything else is under **Later**.

Sources: Media Streams messages https://www.twilio.com/docs/voice/media-streams/websocket-messages · `<Stream>`
https://www.twilio.com/docs/voice/twiml/stream · ConversationRelay https://www.twilio.com/docs/voice/conversationrelay ·
signing https://www.twilio.com/docs/usage/webhooks/webhooks-security · Higgs `docs/models/higgs-realtime/guides/audio-and-voices.md:35-36`,
`docs/api-reference/realtime/client-events.md:113` (item.truncate). Tester C (Oct 23): `audio/pcmu` works natively on 1.0
and 1.5 in both directions. Tester B: Higgs streams about 8× real time, so Twilio holds the whole reply in its buffer.

## Twilio facts used
- `<Connect><Stream url="wss://…">` is bidirectional. No query string in the URL (a path is fine); data goes in `<Parameter>`.
  TwiML after `</Connect>` runs only if *we* close the socket. A call can be redirected at any time with `POST Calls/{CallSid}.json Twiml=…`.
- In: `start` {streamSid, callSid, customParameters}, `media` {payload: b64 µ-law 8 k, 160 B = 20 ms}, `dtmf`, `mark` (echo), `stop`.
- Out: `media` {streamSid, media.payload} (any size, buffered, played in order), `mark` {name} (echoed when everything
  before it has played; echoed at once on `clear`), `clear`.
- ConversationRelay rejected: Twilio does its own STT and TTS and sends us text, which removes Higgs from the audio path (the 30 % criterion).

## 1. Architecture (in scope)
```
phone ─ Twilio ─ GET https://HOST/voice ─┐            cloudflared quick tunnel → localhost:PORT
                 wss://HOST/s/<secret> ──┴─> bridge.py --phone PORT  (one long-lived process, one call at a time)
                                               ├─ websockets.serve(handler, process_request=twiml)   # same port for HTTP + WS
                                               ├─ per call: higgslive.connect(rate=8000, codec="pcmu", playback="client")
                                               └─ backend() unchanged; results outlive the call (HELD → callback)
```
- Startup: run `cloudflared tunnel --url http://localhost:PORT` and parse `https://*.trycloudflare.com` from its stderr. Then
  `POST IncomingPhoneNumbers/{PN}.json VoiceUrl=https://HOST/voice VoiceMethod=GET` so the number points at this run.
  Pick `<secret>` randomly per run.
- Webhook is **GET** on purpose: websockets' `process_request` can answer plain HTTP on the WS port (no aiohttp), and a
  GET has no body to parse. Set `Content-Type: text/xml` on the `Response`: websockets defaults to text/plain, and `Headers` is a multi-dict, so `del` the old header first.
- Env (`.env`): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER` (+1…), `PHONE_ALLOW` (the one verified mobile), `PHONE_PIN`.

## 2. Touch points — pcmu passthrough + `mark` ground truth
**higgslive.py (about 6 lines):**
- `connect.__init__` (line 219) gains `codec="pcm"` and passes it to `Conn`; `Conn.__init__` (line 70) stores
  `self._bps = rate if codec == "pcmu" else rate * 2` (bytes per second of audio).
- Line 97: `fmt = {"type": "audio/pcmu"} if codec == "pcmu" else {"type": "audio/pcm", "rate": self._rate}`. Same fmt for
  input and output, as now.
- Lines 181-182 (playback estimate): keep the estimate when `playback is True`, dividing by `self._bps` instead of `rate*2`.
  New mode `playback == "client"`: each output delta sets `st["spk_until"] = float("inf")` (the client is still playing) and
  bumps `self._n_deltas`.
- New public method `def playback_done(self, n): if n == self._n_deltas: self._st["spk_until"] = time.monotonic()`. Taking the
  mark number closes a race: an echo can arrive after the layer received delta n+1 but before the bridge sent it. `_speak_loop` (line 135) is unchanged:
  it already waits for `now >= spk_until + 1.0`, so the 1 s beat now counts from when audio actually stopped, not from a guess.
  The barge-in reset (line 175, `spk_until=0.0`) is unchanged.
- Inputs unchanged: bridge calls `conn.input_audio.append(base64.b64decode(payload))`; `_audio` re-encodes (µs; no new API).
- `playback=True` (mic bridge) and `False` (headless tests) behave exactly as today. Self-check: assert `_bps` for both codecs.

**`mark` flow (bridge side):** after forwarding output delta number n (counted from 1 in the same order as the layer) as
a Twilio `media` message, send `mark` named `str(n)`. On every `mark` echo, call `conn.playback_done(int(name))`. The layer
ignores any echo but the latest, so a reply still streaming in never gets cut short. On `session.input_speech_started`, send
`clear`. Twilio then echoes all pending marks at once, the last one included, so `playback_done` happens on its own. One mark per delta
(about 20/s) costs nothing and gives 50 ms resolution of "what the caller heard". Using that for `conversation.item.truncate`
is Later.

**bridge.py:**
- New early subcommand next to `say|note` (line 257): `hook` (see §4). It must run before `import higgslive`, so the import
  moves below the subcommand block: one line moved.
- argparse: `--phone PORT`. `main()` splits into an audio-agnostic `call(io, seed)` (the current body from `higgslive.connect`
  down) and two adapters:
  - mic adapter: today's sounddevice code, unchanged;
  - phone adapter: `io.play(b64)` sends `media` + `mark`, `io.clear()` sends `clear`, and an inbound task forwards
    `media` → `input_audio.append`, `dtmf` → PIN check, `stop` → end the call.
  In `events()` only two sinks change: line 481 `spk.put(...)` → `io.play(ev.delta)`, line 477 `clear_spk()` → `io.clear()`.
- `run_delegation` (line 423): the final `conn.session.commentary.append(...)` becomes `await deliver(did, task, text)` (§3).
  Its progress notes go to the live conn if there is one, and are otherwise dropped.
- `RATE` stays 24000 for the mic path. Phone path: `connect(rate=8000, codec="pcmu", playback="client")`.
- `PROMPT` + one line: "The caller is on the phone away from the screen; never ask them to look at or open anything."
  The backend prompt (lines 336, 354-361) gets the same line.
- Reused unchanged: `backend()` (all four), `summarize_tool`, `BACKEND_LOCK`, `context_seed`, the `CALLING_ABOUT` opener, the `say|note` CLI.

**Auth (in scope):** the `/voice` handler checks `X-Twilio-Signature`, which is base64 HMAC-SHA1 of the full public URL
(`https://HOST` + request path with query; GET has no params to append) keyed by the auth token. It also checks
`From == PHONE_ALLOW`. Then it returns `<Gather numDigits="4" action="/voice" method="GET"><Say>PIN</Say></Gather>`.
When the request comes back with `Digits == PHONE_PIN`, it returns `<Connect><Stream url="wss://HOST/s/<secret>"/></Connect>`.
The WS handler accepts only `/s/<secret>`. A second call while one is live gets `<Say>Busy.</Say><Hangup/>`.
Higgs opens only after the PIN, so no billing for strangers. Agent safety rules come from the `/call` skill as they are, plus: nothing from a phone pushes, deletes or reads secrets aloud.

## 3. Idle / duration: hang up and call back (in scope)
State in the bridge process: `LIVE` (current call: conn, io, callSid, or None) and `HELD = []` (results with no one to
hear them), with each entry mirrored as a line in `~/.higgs/held.jsonl` so a restart doesn't lose it.
1. **`deliver(did, task, text)`**: if `LIVE`, call `LIVE.conn.session.commentary.append(text, did)`, as today. Otherwise append
   `(task, text)` to `HELD` and, if no callback is already being dialled, dial one:
   `POST Calls.json To=PHONE_ALLOW From=TWILIO_NUMBER Url=https://HOST/voice Method=GET`.
2. **Higgs closes under a live caller** (`session.closed` with reason `session.idle_timeout` or `session.max_duration_reached`):
   - if `st["pending"]`: `POST Calls/{callSid}.json Twiml=<Response><Say>I'll call you back when it's done.</Say><Hangup/></Response>`;
   - else: `<Say>Call ended.</Say><Hangup/>`.
   Twilio speaks that in its own voice, because the Higgs session is already gone. Then set `LIVE = None`. Tasks keep running:
   `run_delegation` is a task in the process, not in the call.
3. **Caller hangs up** (Twilio `stop`) → close conn, `LIVE = None`. The same `deliver` path covers pending tasks. The voice
   prompt adds: "If the user says goodbye while a task is running, tell them you'll call when it's done."
4. **Any call while `HELD` is non-empty** (the callback or a fresh inbound call) → same `/voice` flow. The WS handler builds
   the seed `Calling about: <n> task(s) finished` + `## Results to report` (each held task + text, ≤4000 chars), then
   empties `HELD`. The existing `CALLING_ABOUT` branch makes the voice open with them. Later results go to the live conn as usual.
   Held results ride in the seed, not as commentary items: there is no open function call left to answer.
5. **Callback not answered**: `HELD` stays and the next inbound call gets it (step 4). No retries.

## 4. The busy-session hook (Claude Code; in scope)
```
registration  .claude/settings.json → hooks.PostToolUse, matcher "*": command `python3 ~/projects/higgs-hackathon/bridge.py hook`
reads         hook stdin JSON {session_id, cwd}; acts only if cwd == ~/.higgs/hook.cwd (written by /call step 1, deleted at hang-up); reads
              ~/.higgs/inbox.jsonl from the byte offset in ~/.higgs/hook.offset, writes the new offset (one consumer)
injects       stdout {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Phone task <id>: <task>\n
              Context: <context>\nAt your next stopping point: bridge.py note <id> \"…\" now, bridge.py say <id> \"…\" when done (≤3 plain sentences)."}}; no new lines → print nothing, exit 0
replies       unchanged: `bridge.py say|note <id>` → outbox.jsonl → backend() returns on the first `say` for that id
idle sessions fire no hooks: the /call skill's background wait loop still covers them. A task seen by both is fine: dedupe by id; a 2nd `say` is ignored
```
`python3`, not `uv run`: it runs after every tool call, so it must be a fast stdlib-only path. That is why `hook` is handled before
`import higgslive`. Codex has no equivalent; for Codex, redirecting a busy task goes through the headless backend.

## 5. Demo beat (Track 3)
1. At the laptop: "refactor the parser and run the full test suite". Walk away from the table.
2. Call the number on speaker: PIN. "How's it going?" → Sam answers from the silent progress notes.
3. Interrupt Sam mid-sentence: "skip the slow tests, fix the tokenizer first". `clear` cuts Twilio's buffer; the redirect lands in the busy session via the hook.
4. "Call me when it's done." Hang up.
5. The phone rings: "Calling about: tests are green, the fix is on a branch."

## 3-hour build order (each step checkable alone)
1. higgslive `codec` + `playback="client"` + self-check asserts (20 min) → `uv run higgslive.py` ok.
2. bridge `--phone`: websockets server, TwiML over GET, cloudflared + VoiceUrl update, pcmu passthrough + `mark`/`clear` (75 min)
   → call in, talk, barge in.
3. Auth: signature + From + Gather PIN + secret path (25 min) → a call from another phone is rejected.
4. `deliver` / `HELD` / callback (35 min) → `--backend fake`, hang up during the 6 s task, phone rings.
5. `bridge.py hook` + settings snippet + SKILL.md step 1/5 writes/deletes `~/.higgs/hook.cwd` (25 min) → inject into a busy session, `say` reaches the call.

## Later
- Multi-session routing (`~/.higgs/sessions/<name>/`, DTMF digit or name match; voice `switch_session` tool).
- `conversation.item.truncate` at the last echoed mark on barge-in, so the model knows what the caller actually heard.
- Transcript-tail status for sessions that aren't watching the inbox; Codex busy-session injection.
- Named tunnel / static domain; one-shot WS tokens; DTMF "press 1 to confirm" for destructive steps; callback retries; macOS notification for unheard results.
- Silent reconnect of a new Higgs session in the middle of a call instead of hang-up-and-call-back.

## Open (non-blocking)
- C: `max_duration_sec`, and whether assistant speech resets the 5-min idle timer (sets how often §3.2 fires). VAD threshold on
  real phone audio with street noise (C's test used a clean clip).
- Builder: verify Twilio accepts the TwiML from websockets `respond()` once the header is swapped to `text/xml`, and that a trial
  account's preamble ("press any key") comes before the Gather.
