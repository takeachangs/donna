# Higgs Audio Hackathon 2026 (Boson AI)

Oct 23-24 2026, Toronto. Demos Sat ~3pm. Track 3 "Agents That Act" (primary), Track 2 secondary.
Rules, judging weights, submission fields: `docs/hackathon.md`. Full decision and findings log: `IDEAS.md`.

**Boson API questions: do NOT fetch the web. Read `docs/INDEX.md` first, then grep `docs/`.**
Every docs.boson.ai page is mirrored 1:1 under `docs/` as markdown; `docs/openapi.json` is the REST spec;
`docs/tutorial/` is the official realtime browser tutorial. Re-mirror with `bash docs/sync.sh`.
The **Gotchas** section of `docs/INDEX.md` holds what the docs don't say (found by probing). Check it before debugging.

## The project
GPT-Live-style client delegation on Higgs Realtime: the voice talks, a coding agent on the user's machine does the work,
the voice keeps chatting and speaks the result when it lands. Goal: do delegation better than Boson's own (their
server-side `_delegate` is a stub; 1.5's version is a thinking-only background model, ours acts).

- `higgslive.py` — the layer, one file, OpenAI live-SDK shape: `connect()` → `session.start({instructions, delegation:{type:"client"}, input, voice, tools})`
  → events (`session.delegation.created` with `delegation.task`, audio/transcript deltas, `session.input_speech_started`)
  → `session.commentary.append` (spoken result), `.thinking.append` (silent progress), `.instructions.append`. Self-check: `uv run higgslive.py`.
- `bridge.py` — mic/speaker app on top of it. Backends: `session` (the `/call` brain: every task goes through `herd.send` to
  `~/.higgs/herd/donna/inbox.jsonl`, the brain replies with `herd.py reply donna <id> take|note|ask|say|fail "…"`; one path,
  with or without `--ring`), `claude` / `codex` (headless CLI in `--project`, default `./sandbox`), `fake`. The seed is
  `~/.higgs/herd/donna/context.txt` (session backend, `--ring`; else `~/.higgs/context.txt`); first line `Calling about: …`
  makes the voice speak first. Log: `bridge.log`.
- `/call` skill: `.claude/skills/call/SKILL.md`, symlinked at `.agents/skills/call` for Codex; `AGENTS.md` points Codex at it.
- `probe/` — old POC (`poc_v1.py`, `poc_v1.log`) and probe scripts. `sandbox/` — where headless backends write.
- `office/` — Donna's office (from Jerrold's Chamber), a display only: Three.js scene + Node server that draws `~/.higgs/office.json`.
  The file's shape is the one contract between brain and view: `docs/office-state.md`. Nothing in `office/` writes state, calls a model or runs git.
  Run: `cd office && npm install && npm run dev` → http://127.0.0.1:5183/ (API 3003; `HIGGS_HOME` picks another folder).

## Facts that cost time to learn
- Higgs tool calls are **asynchronous**: a function call can stay open across turns and its output be returned later. The layer leaves the call open and returns the backend's answer as the real `function_call_output`. Docs don't say this.
- Tool name is `delegate_task`. **Never `delegate`** (or `web_search`): the server hijacks those names and runs them itself.
- Only `tool_choice: "auto"` works. `response.create` must be bare (a body makes the model greet from scratch). Wait for `conversation.item.added` before requesting a reply to an injected item.
- Turn detection: `server_vad` (threshold 0.85); `silence_duration_ms` 800 on a live mic (`--silence-ms` overrides): the server's 500, and our 400 tuned on a TTS clip, cut real speech mid-sentence. `--text`/`--wav` keep the server default.
- Realtime 1.5 preview (`higgs-realtime-1.5-preview`): works, same protocol; `connect(model=…)`. Full findings `docs/realtime-1.5.md`. Caveats: ~2 simultaneous generations per key (one key per live call, retry on `upstream_error`); it sometimes claims a handoff without calling `delegate_task`; its background "thinking" model is not reachable in the API (`_delegate` is still the stub).

## Running
```bash
export BOSON_API_KEY=…      # ~/.zshrc; a second key is BOSON_API_KEY_2 in .env (gitignored)
uv run bridge.py --backend claude --voice nora --out AirPods      # laptop mic in, AirPods out (AirPods mic degrades STT)
uv run bridge.py --backend fake --silent --text "a | b"           # headless check, no mic, no agent credits
uv run bridge.py --model higgs-realtime-1.5-preview …            # 1.5 preview (default is higgs-realtime)
uv run bridge.py --ring --backend session --voice nora           # Donna's phone: no call open; a `say` in ~/.higgs/herd/donna/outbox.jsonl rings, Enter calls her
```
`~/.zshrc` exports an `ANTHROPIC_API_KEY` with low credit; `bridge.py` strips it so headless `claude -p` bills the claude.ai login.

## Conventions
- Keep it cheap: text-mode probes (`output_modalities: ["text"]`) cost cents; don't leave sessions running.
- Never commit `.env` or keys; the repo goes public for submission, pinned to a commit SHA.
- Record new Boson findings in `docs/INDEX.md` Gotchas and the decision log in `IDEAS.md`.

## Contracts that must not drift
Changing any of these means changing every side in the same commit.
- `~/.higgs/office.json` shape, `WorkStatus` words, `call.state` words (`docs/office-state.md`): `herd.office()` ↔ `office/`.
- `~/.higgs/state.json` `{"state": "off|ringing|listening|thinking|speaking"}`: `bridge.py` writes it every 250 ms, `off`
  last; `herd.office()` reads a file older than 3 s as `off`.
- Herd line shapes (`docs/herd.md` §4, §6, §8). Inbox `{id, task, context, from, ts}` plus `transcript` (`[[role, text]]`,
  role `user`/`assistant`, the call's last 12 turns), `in_reply_to` (the answer to an `ask`), `replaces` (a correction).
  Outbox `{id, kind: take|note|ask|say|fail, text, ts}`. Writers `bridge.py`, `herd.py`; readers the `/call` skill,
  `herd.py hook`, `higgslive.status_summary`.
- `delegate_task` parameters `task`, `replaces` (`higgslive.TOOL_DEF`) ↔ the `# Corrections` rule in `bridge.py` `PROMPT`.
- `hooks/office.json` event list ↔ `herd.py hook` and the `office()` reducer.
- `Hanging up now.`: `SIGN_OFF` in `bridge.py` only (`PROMPT` interpolates it; hearing it in the voice's transcript closes
  the call); the skill names it in prose. `Calling about:`: `CALLING_ABOUT` in `bridge.py` and the `/call` skill.
