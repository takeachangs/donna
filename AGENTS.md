# Donna

A voice secretary for local coding agents, built for the Higgs Audio Hackathon 2026 in Toronto
(October 23–24; Track 3, "Agents That Act"). Read `README.md` and `CLAUDE.md` for the product and
current workflow. This file carries the same architecture and development rules for Codex and
other agents. Historical decisions live in `IDEAS.md`; the demo run sheet is `docs/demo.md`.

## Read the local documentation first

- For Boson API questions, **do not fetch the web**. Read `docs/INDEX.md`, including its Gotchas,
  then search `docs/`. The local mirror includes the REST spec (`docs/openapi.json`), realtime
  protocol pages and the official browser tutorial (`docs/tutorial/`).
- `bash docs/sync.sh` refreshes the mirror; it is an explicit network operation, not a test.
- Record new Boson findings in the Gotchas section of `docs/INDEX.md` and design decisions in
  `IDEAS.md`. Treat dated probe results as measurements, not guarantees for every model/key.

## Architecture and ownership

- **Voice — `bridge.py` and `higgslive.py`.** `higgslive.py` is the asynchronous client-delegation
  layer: `connect()` → `session.start(...)` → events, `session.commentary.append` for spoken
  results and `session.thinking.append` for silent progress. `bridge.py` owns mic/speaker audio,
  ring mode, corrections and transfers. Backends are `session` (the interactive brain), `claude`
  and `codex` (headless CLIs in `--project`, default `./sandbox`), and `fake`.
- **Brain — the user's own Claude Code or Codex session on `/call`.** Its canonical instructions are
  `.claude/skills/call/SKILL.md`; `.agents/skills/call` points there for Codex. If a Windows clone
  materializes that symlink as a text file, read the canonical file directly. `herd.py` is a
  mailbox/state reducer. Claude Code dispatches named workers through its Agent tool and hooks;
  Codex dispatches named workers through `herd.py new/send`, which runs `codex exec --json` and
  resumes their native threads. `--brain-engine` is explicit and defaults to Claude.
- **Office — `office/`.** This is the read-only Chamber-derived Three.js display and Node
  server. It draws `$HIGGS_HOME/office.json`, default `~/.higgs/office.json`. Do not add state
  mutation endpoints, model calls, executors or git operations to the office. Read
  `office/AGENTS.md`, its README and architecture before editing it.
- **Supporting files.** `docs/herd.md` specifies the mailbox and lifecycle;
  `docs/office-state.md` specifies the shared display contract. `dash.py` supplies transcript
  inspection/fallbacks. `probe/` contains historical probes, not the primary app.

## Being Donna's brain

Only activate `/call` when the user requests that role or a voice call. Editing this repository
does not itself mean going on duty, starting a phone session or consuming the user's inbox.
Follow the full skill when on duty; these are its core invariants:

- The transcript contains the user's request; the voice's `task` summary is not a replacement
  for their words. Ask one concrete question with a proposal when the request is genuinely thin.
- The brain plans, delegates, reviews and reports. Named background workers make changes,
  including small documentation/config edits: Sonnet subagents on Claude, herd Codex workers
  on Codex. There is no direct-work exception for the Codex brain. Apply these role rules when
  running `/call`, not as a hidden requirement to launch
  a live orchestrator for ordinary repository maintenance.
- Work in a task worktree on `donna/<slug>`; never checkout/switch branches in the person's
  project directory. Worker briefs name the worktree, scope, acceptance checks and reporting
  requirements. Review actual changes and run the project's checks before reporting success.
- Reply through `herd.py reply donna <id> take|note|ask|say|fail|transfer "..."`. `take` and
  `note` are silent; `ask` requests an answer; `say`/`fail` are terminal results. One result per
  task on its original ID. A `say` off the line can ring the user, so progress is not a `say`.
- `in_reply_to` resumes the original question; `replaces` supersedes the earlier task; `with`
  identifies a worker on the phone. Forward worker questions to that worker rather than invent
  their answer. Keep waiting for new inbox tasks while background work runs; handle IDs once.
- Follow the skill's approval flow for outward/destructive actions; existing user authorization
  still applies. Do not silently edit the user's Claude settings to install hooks.

## Contracts that must stay in sync

Change the producer, consumers, tests and documentation together when changing these contracts:

- **Office state:** `herd.office()` / `herd.write_office()` ↔ `office/` workspace types/rendering
  ↔ `higgslive.office_status` (`task_status`). Keep worker identity/name/role/status/lead and
  briefing identity/summary/status aligned. Work statuses are
  `queued|working|waiting|review|done|paused|failed`.
- **Call state:** `bridge.py` writes `$HIGGS_HOME/state.json` every 250 ms and writes `off` last.
  States are `off|ringing|listening|thinking|speaking`; `with` names Donna or the transferred
  worker. The reducer treats a file older than 3 s as off and resolves the worker's ID for
  `office.json` `call.with`.
- **Mail:** inbox fields include `id, task, context, from, ts` plus `transcript` (last 12
  `[role, text]` turns), `in_reply_to`, `replaces` and `with`; outbox fields are
  `id, kind, text, ts`, with kinds `take|note|ask|say|fail|transfer`. Preserve lifecycle/idempotency
  in `herd.py`, the bridge, `/call`, hooks and voice status readers (`docs/herd.md`).
- **Tools/hooks:** `delegate_task` parameters `task` and `replaces` in `higgslive.TOOL_DEF` ↔
  correction rules in `bridge.py` `PROMPT`; `hooks/office.json` events ↔ `herd.py hook` and the
  office reducer. A transfer opens a fresh worker voice session, not a mid-call voice update.
- **Phone phrases:** keep `SIGN_OFF` (`Hanging up now.`) and `BACK` (`Putting Donna back on.`)
  defined only in `bridge.py` and interpolated into prompts. Keep `CALLING_ABOUT` (`Calling
  about:`) aligned with `/call`. These are control signals, not incidental copy.

## Higgs behavior to preserve

- Delegation is asynchronous: keep client tool calls open across turns and return the backend
  result as the matching `function_call_output`. Never return output for server-executed tools.
- Use `delegate_task`; `delegate` and `web_search` are reserved. Only `tool_choice: "auto"`
  works reliably in the recorded probes. Send a bare `response.create`; wait for
  `conversation.item.added` before requesting a response to an injected item.
- Live mic VAD uses 800 ms silence (override with `--silence-ms`); shortening it cut real
  speech mid-sentence. Text/WAV probes keep the server default unless explicitly overridden.
- The default is `higgs-realtime`; `--model higgs-realtime-1.5-preview` selects the preview.
  Read `docs/realtime-1.5.md` and the Gotchas for concurrency, skipped-tool and audio-rate
  caveats. Preserve delegation guards, task/result pairing and the conversational hold policy.

## Run and validate

The original live setup is macOS with `uv`, tmux, an agent CLI, a Boson key and an audio output
device. `--out` must match a real device; wired headphones avoid mic echo. The hook file and
`/call` examples contain the original `~/projects/higgs-hackathon` path: account for the actual
checkout location during setup rather than assuming it exists. On Windows, `start-windows.ps1`
uses the native Codex brain/worker CLI, local dependencies and a separate demo project. The
host resumes the brain on phone requests and worker results, so tmux and Claude hooks are
unnecessary. Preserve the skill's orchestration/review rules and the existing permission modes.

```sh
uv run bridge.py --ring --backend session --voice nora --out EarPods --brain <repo>
# Optional: --brain-model sonnet chooses the Claude brain model.
cd office && npm install && npm run dev  # UI 5183, API 3003; avoid occupied ports.
```

`BOSON_API_KEY` configures voice; `BOSON_API_KEY_2` is the optional second key. `HIGGS_HOME`
isolates runtime files. The bridge removes `ANTHROPIC_API_KEY` from Claude subprocesses so they
use the user's claude.ai sign-in. Do not change the user's global model/auth settings.

Offline Python self-checks (no mic, Higgs call or agent inference):

```sh
uv run bridge.py selftest
uv run higgslive.py
uv run herd.py
```

`uv` may fetch the scripts' declared dependencies. The **voice integration** demos
`uv run tests/fake_donna.py --demo`, its other driver modes, `uv run test_ring.py`, and
`bridge.py --backend fake --silent --text "..."` still open real Higgs sessions: a fake brain
does not make the voice offline/free; `--engine codex` also runs real Codex workers. Run
`python tests/test_codex.py` for the fake-CLI worker, resume, failure and native-brain checks.
Run paid/live checks only when authorized, isolate their
`HIGGS_HOME`, close sessions afterwards and report measured usage; unknown credit debit stays
unknown. Prefer short text-mode probes where they answer the question.

For office changes, run `npm test`, `npm run typecheck`, `npm run check:repo` and `npm run build`
from `office/`; verify rendered UI for visual changes. Follow `office/AGENTS.md` for English
copy in both locale files, `transitionTo(...)` animations and upstream licensing boundaries.

Never commit `.env`, keys, runtime mailbox/state files, native sessions, logs, probe audio,
dependencies or sandbox workspaces. Preserve existing tasks and histories. The submission may
be made public and pinned to a commit SHA; publishing/pushing is a separate user-authorized
action. Do not infer permission to publish from the hackathon deadline.
