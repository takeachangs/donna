# Higgs Audio Hackathon 2026 (Boson AI)

Oct 23-24 2026, Toronto. Demos Sat ~3pm. Track 3 "Agents That Act" (primary), Track 2 secondary.
Rules, judging weights, submission fields: `docs/hackathon.md`. Full decision and findings log: `IDEAS.md`.

**Boson API questions: do NOT fetch the web. Read `docs/INDEX.md` first, then grep `docs/`.**
Every docs.boson.ai page is mirrored 1:1 under `docs/` as markdown; `docs/openapi.json` is the REST spec;
`docs/tutorial/` is the official realtime browser tutorial. Re-mirror with `bash docs/sync.sh`.
The **Gotchas** section of `docs/INDEX.md` holds what the docs don't say (found by probing). Check it before debugging.

## The project
GPT-Live-style client delegation on Higgs Realtime: the voice talks, a coding agent on the user's machine does the work,
the voice keeps chatting and speaks the result when it lands. Goal: delegation where the agent acts on the user's machine.
Three parts (Oct 24 architecture; the log is `IDEAS.md` from "Oct 24 ~07:00"):
- **Voice** = `bridge.py` + `higgslive.py`. `higgslive.py` is the layer, one file, OpenAI live-SDK shape: `connect()` → `session.start({instructions, delegation:{type:"client"}, ...})`
  → events → `session.commentary.append` (spoken result), `.thinking.append` (silent progress). Self-check: `uv run higgslive.py`.
  `bridge.py` is the mic/speaker app: `--ring` (the phone: rings on a `say`, Enter calls), correction, transfer to a worker's voice (#28).
  Backends: `session` (the brain), `claude` / `codex` (headless CLI in `--project`, default `./sandbox`), `fake`. Log: `bridge.log`.
- **Brain** = the user's own Claude Code session on the `/call` skill (`.claude/skills/call/SKILL.md`; symlinked at `.agents/skills/call` for Codex).
  `herd.py` is the mailbox: the bridge `send`s tasks to `~/.higgs/herd/donna/inbox.jsonl`, the brain answers with
  `herd.py reply donna <id> take|note|ask|say|fail|transfer "…"` (`docs/herd.md`). Workers are the brain's Agent-tool subagents,
  each task in a git worktree. Hooks (`hooks/office.json` → `herd.py hook <Event>`) report the brain and its workers and wake a brain that went quiet.
  `bridge.py --brain REPO` starts it in tmux `donna`.
- **Office** = `office/`, a display only (from Jerrold's Chamber): Three.js scene + Node server that draws `~/.higgs/office.json`.
  The file's shape is the one contract between brain and view: `docs/office-state.md`. Nothing in `office/` writes state, calls a model or runs git.
- `probe/` — old POC and probe scripts. `sandbox/` — where headless backends write. Demo run sheet and submission draft: `docs/demo.md`.

## Facts that cost time to learn
- Higgs tool calls are **asynchronous**: a function call can stay open across turns and its output be returned later. The layer leaves the call open and returns the backend's answer as the real `function_call_output`. Docs don't say this.
- Tool name is `delegate_task`. The function name `delegate` (and `web_search`) is reserved by the server; ours is `delegate_task`.
- Only `tool_choice: "auto"` works. `response.create` must be bare (a body makes the model greet from scratch). Wait for `conversation.item.added` before requesting a reply to an injected item.
- Turn detection: `server_vad` (threshold 0.85); `silence_duration_ms` 800 on a live mic (`--silence-ms` overrides): the server's 500, and our 400 tuned on a TTS clip, cut real speech mid-sentence. `--text`/`--wav` keep the server default.
- Realtime 1.5 preview (`higgs-realtime-1.5-preview`): works, same protocol; `connect(model=…)`. Full findings `docs/realtime-1.5.md`. Caveats: ~2 simultaneous generations per key (one key per live call, retry on `upstream_error`); it sometimes claims a handoff without calling `delegate_task`.

## Running
```bash
export BOSON_API_KEY=…      # ~/.zshrc; a second key is BOSON_API_KEY_2 in .env (gitignored)
uv run bridge.py --ring --backend session --voice nora --out EarPods --brain <repo>   # the phone + the brain (tmux attach -t donna)
uv run bridge.py … --brain <repo> --brain-model sonnet                              # the brain on another model (passed to claude --model)
uv run bridge.py … --brain <repo> --brain-engine codex                             # #66: the brain on Codex; workers are herd.py codex agents (codex exec), office rows from herd files, no hooks
cd office && npm install && npm run dev                           # the office: http://127.0.0.1:5183/ (API 3003; HIGGS_HOME picks another folder)
```
Wired EarPods are the output (the laptop mic hears the speakers, and AirPods' Bluetooth mic degrades STT); `bridge.py` exits if `--out` matches no device.
Headless checks, no mic and no agent credits: `uv run bridge.py selftest`, `uv run higgslive.py`, `uv run herd.py`,
`uv run tests/fake_donna.py --demo`, `uv run bridge.py --backend fake --silent --text "a | b"`.
`--model higgs-realtime-1.5-preview` selects the 1.5 preview (default `higgs-realtime`).
`~/.zshrc` exports an `ANTHROPIC_API_KEY` with low credit; `bridge.py` strips it so headless `claude -p` bills the claude.ai login.

## Conventions
- Keep it cheap: text-mode probes (`output_modalities: ["text"]`) cost cents; don't leave sessions running.
- Never commit `.env` or keys; the repo goes public for submission, pinned to a commit SHA.
- Record new Boson findings in `docs/INDEX.md` Gotchas and the decision log in `IDEAS.md`.

## Contracts that must not drift
Changing any of these means changing every side in the same commit.
- `~/.higgs/office.json` shape, `WorkStatus` words, `call.state` words (`docs/office-state.md`): `herd.office()` ↔ `office/`, and
  `higgslive.office_status` (the voice's `task_status`: `workers[].{name,role,status,lead}`, `briefings[].{id,summary,status}`, #43).
- `~/.higgs/state.json` `{"state": "off|ringing|listening|thinking|speaking", "with": "<name>"}` (`with` while a call is on:
  "donna" or the worker the user was put through to, #28): `bridge.py` writes it every 250 ms, `off` last; `herd.office()`
  reads a file older than 3 s as `off` and turns `with` into `office.json` `call.with` (that worker's id, or "donna").
- Herd line shapes (`docs/herd.md` §3, §6, §7). Inbox `{id, task, context, from, ts}` plus `transcript` (`[[role, text]]`,
  role `user`/`assistant`, the call's last 12 turns), `in_reply_to` (the answer to an `ask`), `replaces` (a correction),
  `with` (the worker the user is on the line with: the brain forwards to them, #28).
  Outbox `{id, kind: take|note|ask|say|fail|transfer, text, ts}` (`transfer`: text = the worker's name). Writers `bridge.py`, `herd.py`; readers the `/call` skill,
  `herd.py hook`, `higgslive.status_summary`.
- `delegate_task` parameters `task`, `replaces` (`higgslive.TOOL_DEF`) ↔ the `# Corrections` rule in `bridge.py` `PROMPT`.
- `hooks/office.json` event list ↔ `herd.py hook` and the `office()` reducer.
- `Hanging up now.`: `SIGN_OFF` in `bridge.py` only (`PROMPT` interpolates it; hearing it in the voice's transcript closes
  the call); the skill names it in prose. `Putting Donna back on.`: `BACK` in `bridge.py` only (`worker_prompt` interpolates
  it; hearing it from a worker's voice puts Donna back). `Calling about:`: `CALLING_ABOUT` in `bridge.py` and the `/call` skill.
