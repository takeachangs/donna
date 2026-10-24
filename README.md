# Chamber

**Your personal office for AI work.** Each project has a room on a shared floor; Donna keeps work moving and holds completed results for your next briefing.

A local personal office: speak to a Higgs secretary, delegate real work to local Codex or Claude Code sessions, and review actual deliverables in project rooms. The Office floor brings all projects and decisions together. Workers name themselves; Donna's brain chooses the team.

## Run

**Prerequisites:** Node.js 22.12+ and npm; Codex CLI and/or Claude Code installed and signed in (workers use your local sign-in; no credentials ship with this repository).

```sh
npm ci
cp .env.example .env     # set BOSON_API_KEY
npm run doctor
```

`npm run doctor` runs the same boot checks as `npm start`, prints one plain line per problem and a summary. `FATAL:` lines (Node older than 22.12, data directory not writable) mean the server will refuse to start. `warn:` lines (no `BOSON_API_KEY`, default worker engine not signed in, Donna's brain unavailable) mean the server starts but that feature will not work.

**Demo machine (production):**

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3003/**. One process serves the UI, API and WebSocket; keep it running while native tasks are in progress. Set `AGENCY_PORT` to use another port; if `npm run dev` is running, stop it first or pick another port. Check it is healthy:

```sh
curl -s http://127.0.0.1:3003/agency-api/health
```

If the voice drops (Higgs idle timeout, network, session rotation), do nothing: Donna reconnects on your next action and carries the conversation over. If a reply fails twice she says "Sorry, say that again?"; just repeat yourself.

**Development:** `npm run dev` serves the UI at **http://127.0.0.1:5183/** with the API on loopback port 3003. The UI and project board can be inspected without paid voice. Choose **Talk to secretary**: the call connects with the microphone live and Donna picks up first ("Hey, it's Donna. What do you need?"). On a call the controls are **Hang up**, **Hold on** and **Mute**; **Type instead** opens the text box. If the browser blocks the microphone, the button reads **Enable microphone** and the status line says so. Existing `/agency.html` bookmarks still work.

**Environment** (`.env` or shell): `BOSON_API_KEY` (required for voice), `AGENCY_PORT` (default 3003), `AGENCY_DATA_DIR` (default `artifacts/agency`). `AGENCY_DEFAULT_PROVIDER` (`codex` or `claude`) picks the worker engine when the plan does not name one; unset, the server uses Codex when signed in, otherwise Claude Code, and logs which and why. `AGENCY_BRAIN_MODEL` (default `opus`) is the model for Donna's brain. `AGENCY_CODEX_BIN` and `AGENCY_CLAUDE_BIN` are needed only if the executable is not on PATH; `AGENCY_CLAUDE_MODEL` defaults to `sonnet`. `AGENCY_VAD_SILENCE_MS` (default 800) is the silence before Higgs ends your turn. Claude Code workers use your claude.ai sign-in; the server removes `ANTHROPIC_API_KEY` from their environment so a shell API key is never billed.

## How the office works

- **Donna's voice** (Higgs) takes your goal and nothing more. **Donna's brain** is a persistent Claude Code orchestrator per project: it reads the project, spawns 1–4 Sonnet workers as its own parallel subagents (small tasks normally need one), forwards your messages to them, then reviews their files and writes one briefing. Ask "what is Mika doing" or tell a worker something and Donna uses `worker_status` / `message_worker`. Workers never talk to you.
- The **···** beside a project opens **Project settings** for renaming or recoverable deletion. **Recently deleted** restores the same room, files, reports and native sessions. Deleting pauses active work; restoring keeps it paused.
- **Project rooms** show real assignments, fixed desks and saved deliverables. **Details** contains the full report, checks and native session reference.
- **Office floor** is the global view. Project rooms expand along a shared hall, with Donna's suite at the entrance. Workers stay at their desks; a completed workflow triggers a short delivery trip to Donna and back.
- **Briefing queue** at Donna holds saved results, files and verification. The next report is highlighted, followed by a numbered waiting list. Choose **Read report** or **Connect & listen**. When a result lands, Donna tells you if you are connected (at a natural pause), or the office rings: choose **Answer Donna** and she opens with that report ("The bakery page is done, Ellis and Miles finished it. Want the short version?"); say yes to hear it. Interrupted speech leaves the report queued. Presentation and acceptance are separate: a result remains **Ready for review** until you accept it in its project room.
- Existing results migrate into the queue without replaying old animations on every reload. **Replay handoff** previews a delivery route without changing the queue. Reduced-motion preferences skip delivery animation.
- **Hold on** interrupts Donna's voice. Saying bye or talk later, or **Hang up**, ends the call; results that land afterwards ring again. During a call the board's buttons (decisions, Read report, Pause work) are hidden and Donna asks decisions out loud; they return when the call ends. **Pause work** pauses native execution. Closing the browser or changing rooms does not cancel background work.
- Codex owns detailed conversation history. Resume the exact session using the command shown under execution details; the office keeps concise memory and references.

Default Codex execution is **GPT-6.1 Sol / low**; the brain can choose medium for a specific worker, and brain steps (plan, review) run at medium effort. One native writer runs at a time. Project working directories are isolated. The secretary provides the spoken interaction; workers currently return text and files. Arbitrary repository attachment, mail, calendar, deployment and independent worker voices are not implemented.

Claude Code runs Donna's brain and its workers (`apps/server/src/agency/claude.ts`). The brain is an orchestrator session with Agent, SendMessage, Skill, file tools and sandboxed Bash, confined to the project directory by the sandbox and scoped allow rules (not `--restricted` or `--safe-mode`, which disable skills). Its Sonnet subagents are the workers, shown from its stream-json output; a user message reaches a running worker through the brain's stdin. Its prompts live in two skills, `skills/donna-brain` and `skills/donna-worker`, copied into each room's `workspace/.claude/skills`. When you ask for Codex, the brain returns a JSON plan and the old one-writer Codex queue runs it; `AGENCY_DEFAULT_PROVIDER` still applies there. The status check runs `claude auth status`, never inference; offline tests use a fake CLI. Verified live on 2026-10-24 (Claude Code 2.1.309, Opus brain): "build a landing page with a contact form" ran two Sonnet workers in parallel, a mid-run "tell Theo to use a blue palette" reached the brain through its stdin and was acknowledged in the one briefing, in 70 s.

## Source and private data

```text
apps/web/                 Office UI, audio and a small Three.js scene
apps/server/src/agency/   Secretary, workspace, persistence and native adapters
tests/                    Offline regression tests
scripts/                  Dev launcher, explicit live test, source packaging
skills/                   donna-brain and donna-worker prompts for Claude Code
docs/                     Architecture, upstream provenance and cleanup report
licenses/                 Retained third-party licenses
```

`artifacts/agency/` holds your projects, workspaces, delivery snapshots, audio and usage logs. It is created locally and excluded from Git and source packages. Existing data remains readable, including earlier drafts. Back it up separately; native workspace paths may be absolute, so moving an existing installation needs a path migration.

See [architecture](docs/ARCHITECTURE.md), [upstream comparison](docs/UPSTREAM.md) and [third-party notices](THIRD_PARTY_NOTICES.md). This is an independent application using a small attributed rendering subset of Agentshire. It does not need a separate Agentshire checkout, editor or server.

## Verify and package

```sh
npm test
npm run build
npm run check:repo
npm run package:source
```

Packaging requires a committed, clean Git tree. It creates a source ZIP and SHA-256 file in ignored `releases/`; it never publishes a remote repository. Original application code is private/`UNLICENSED`; third-party MIT and CC0 terms are retained separately.

`npm run test:live` is a separate **paid Higgs + authenticated Codex integration test**. It creates a project and actual files. Run it deliberately, not as part of routine tests or CI. Offline tests use controlled executors/transports and do not establish live model quality or latency.

Usage evidence stays in `artifacts/agency/calls.jsonl` and `executions.jsonl`. Higgs dollar figures are token-rate estimates, not a credit-balance reconciliation. Codex token counters may be cumulative per native session; do not sum resumed-job totals as new usage.

For a focused **paid, read-only Higgs conversation diagnostic**, run `node --import tsx scripts/secretary-conversation-live.ts regression`. It uses the existing pitch project's saved context, retains inputs, replies and audio under `artifacts/agency/donna-debug/`, and does not launch Codex. Review the actual replies; a completed script alone is not a semantic PASS. Normal typed requests now have private input traces linked to their response rows, so clarification loops can be inspected without guessing what was submitted.
