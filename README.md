# Chamber

**Your personal office for AI work.** Each project has a room on a shared floor; Donna keeps work moving and holds completed results for your next briefing.

A local personal office: speak to a Higgs secretary, delegate real work to local Codex or Claude Code sessions, and review actual deliverables in project rooms. The Office floor brings all projects and decisions together. Workers name themselves; the secretary chooses the team size.

## Run

Requires Node.js 22.12+ and npm. One install covers both apps.

```sh
npm ci
```

Copy `.env.example` to `.env`, set `BOSON_API_KEY`, and sign in to your local Codex CLI. Set `AGENCY_CODEX_BIN` only if the executable is not on PATH. Claude Code workers use your local `claude` sign-in (claude.ai); the server removes `ANTHROPIC_API_KEY` from their environment so a shell API key is never billed. `AGENCY_CLAUDE_BIN` and `AGENCY_CLAUDE_MODEL` (default `sonnet`) are optional. Credentials stay in the backend/native CLI; no credentials are bundled with this repository.

```sh
npm run dev
```

Open **http://127.0.0.1:5183/**. Existing `/agency.html` bookmarks still work. The development API listens on loopback port 3003. The UI and project board can be inspected without connecting paid voice. Choose **Talk to secretary**, then **Enable microphone**, to start speech; text input is also available after connection.

For the production build, stop development first:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3003/**. One server serves the built office, API and WebSocket. Keep it running while native tasks are in progress.

## How the office works

- **Donna, your secretary**, receives goals, follows project memory and delegates 1–4 useful work packages. Small tasks normally need one worker.
- The **···** beside a project opens **Project settings** for renaming or recoverable deletion. **Recently deleted** restores the same room, files, reports and native sessions. Deleting pauses active work; restoring keeps it paused.
- **Project rooms** show real assignments, fixed desks and saved deliverables. **Details** contains the full report, checks and native session reference.
- **Office floor** is the global view. Project rooms expand along a shared hall, with Donna's suite at the entrance. Workers stay at their desks; a completed workflow triggers a short delivery trip to Donna and back.
- **Briefing queue** at Donna holds saved results, files and verification. The next report is highlighted, followed by a numbered waiting list. Choose **Read report** or **Connect & listen**. When a result lands, Donna tells you if you are connected (at a natural pause), or the office rings: choose **Answer Donna** to hear that report first. Interrupted speech leaves the report queued. Presentation and acceptance are separate: a result remains **Ready for review** until you accept it in its project room.
- Existing results migrate into the queue without replaying old animations on every reload. **Replay handoff** previews a delivery route without changing the queue. Reduced-motion preferences skip delivery animation.
- **Stop speaking** interrupts voice. **Pause work** pauses native execution. Closing the browser or changing rooms does not cancel background work.
- Codex owns detailed conversation history. Resume the exact session using the command shown under execution details; the office keeps concise memory and references.

Default execution is **GPT-6.1 Sol / low**; the secretary can choose medium for a specific assignment. One native writer runs at a time. Project working directories are isolated. The secretary provides the spoken interaction; workers currently return text and files. Arbitrary repository attachment, mail, calendar, deployment and independent worker voices are not implemented.

Claude Code is a verified second worker engine (`apps/server/src/agency/claude.ts`). Codex stays the default; Donna sets `provider: "claude"` on a worker when you ask for Claude. A worker is bound to its engine's native session: the first run creates it with `--session-id`, later runs `--resume` it. Claude workers have file tools only (Read, Edit, Write, Glob, Grep) confined to the project directory, with no shell, hooks or MCP. The status check runs `claude auth status`, never inference; offline tests use a fake CLI. Verified live on 2026-10-24: a new file assignment and a resumed follow-up each finished in about 8 s on Sonnet and reached review and the briefing queue.

## Source and private data

```text
apps/web/                 Office UI, audio and a small Three.js scene
apps/server/src/agency/   Secretary, workspace, persistence and native adapters
tests/                    Offline regression tests
scripts/                  Dev launcher, explicit live test, source packaging
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
