# Architecture

Chamber is a local application with one browser client and one Node server. The room scene is a view of real work, not another agent runtime.

## Runtime

1. **Office client — `apps/web/src/agency`**: English room navigation, 3D office, voice playback and interruption, project board, decisions and deliverables. Plain TypeScript and Three.js; no React or town editor.
2. **Secretary voice — `secretary.ts`, `higgs.ts`, `server.ts`**: one Higgs Realtime conversation interprets speech, reads compact project memory and calls explicit workspace tools. It passes the user's goal on and never staffs: team size, roles and engines are not its decision. It does not invent completed work.
3. **Brain — `workspace.ts` brain turns, `claude.ts` brain mode, `plans.ts` contract, `skills/donna-brain`**: Donna's brain is a per-project, persistent Claude Code orchestrator (`--session-id` / `--resume`, model `AGENCY_BRAIN_MODEL`, default opus) with tools Agent, SendMessage, Skill, Read, Edit, Write, Glob, Grep and sandboxed Bash, confined to the room's workspace by the sandbox and `Edit(./**)`/`Write(./**)` allow rules (`--restricted` and `--safe-mode` are not used: both disable skills). Its prompt is the skill `donna-brain`, installed with `donna-worker` into each room's `workspace/.claude/skills` at project creation and server start; the workspace sends only data (project, memory, team, names in other rooms, request, user messages). The brain spawns 1–4 Sonnet workers in parallel as background subagents, forwards user messages with SendMessage (the workspace injects them into its stdin stream-json), reviews their files and ends with `{summary, verification, needsInput}`. Only when the user asks for Codex does it return the old JSON plan (`brainPlanSchema`) and the Codex queue runs it. A per-project lead worker (`lead: true`) mirrors the brain's status and gets no desk.
4. **Workspace — `workspace.ts`, `projects.ts`, `state.ts`**: persisted goals, checkpoints, dependencies, decisions, worker/session references and immutable delivery snapshots. A single queue permits one native writer at a time. `state.ts` only preserves the original room/document storage format; the old three-bot scheduler and tools have been removed.
5. **Execution — `codex.ts`, `executors.ts`, `claude.ts`**: workers are Claude Code Sonnet subagents of the brain, shown as workers (desk, name, latest tool use) from the brain's stream-json events; they are not queued, so several run at once, each owning distinct files. The pump never executes them. Voice tools `worker_status` (answers from that live view) and `message_worker` (forwarded now if the brain is running, otherwise at its next turn through a persisted inbox) are the voice's only handle on them. Codex stays the old path: a plan with `provider: "codex"` workers goes through staff → one-writer queue → review. The native engine owns conversation history; the app keeps session IDs and concise results. A Codex worker stays bound to its session; the single queue runs one Codex writer at a time. `AGENCY_DEFAULT_PROVIDER` applies to workers of a Codex-path plan that names no engine.

The client talks to `/agency-api/*` and `/agency-ws`. Only the backend holds the Boson credential. The native executor uses its own local sign-in. No browser-to-model credentials and no extra database, message broker or cloud GPU are required.

## Data ownership

`artifacts/agency/` is private local runtime data, excluded from Git and source packages:

- `projects.json`: project catalog, names and optional `deletedAt` tombstones. Entries keep their order so floor positions remain stable after delete/restore.
- `workspace.json`: secretary identity, project memory, assignments, decisions, persistent briefings and activity.
- `rooms/`: compatible existing project records and old documents.
- `workspaces/`: actual native execution directories.
- `deliveries/`: versioned file snapshots for review.
- `inputs.jsonl`, `calls.jsonl`, `executions.jsonl`, `audio/`: private input traces, usage evidence and retained speech. Text response rows link to the exact submitted text and job; old rows without inputs cannot establish what the user said.

Donna's current workspace context is refreshed in session instructions, separate from actual user messages. Old draft bodies are read on demand. Current state establishes execution facts; the user's latest correction establishes intent. Typed follow-ups keep the caption history even if audio is still playing. Microphone interruption and explicit stop still use the audio playhead.

Project tools accept `project_id: "selected"`, which the server resolves to the current room, so the secretary never reconstructs UUIDs. When no room is selected (the office starts with Donna alone), `delegate_work` and `read_workspace` resolve to no project instead of failing; `delegate_work` then creates the room from the goal. Explicit unknown IDs are still rejected, never silently redirected. Identical failed tool retries stop with a visible error; the total tool-round limit also reports an error rather than appearing to finish successfully.

Existing native workspaces can contain absolute paths. Keep this directory in place during source refactors. Moving an existing installation to a different machine/path needs an explicit workspace-path migration; the source ZIP is not a user-data backup.

## Floor and result handoff

The Office floor is the global view (the internal `command` view identifier remains compatible). `floor.ts` gives each project a stable doorway onto the shared hall; growing a team expands its room outward, and new projects add rows. Donna's suite stays at the entrance. `Scene.ts` renders this persisted workspace and animates new deliveries; animation never commits completion or controls execution.

`briefings.ts` reconciles terminal, successful workflow deliveries into immutable saved reports. Intermediate steps pass to their dependents, and the final report includes the dependency chain's file snapshots. The review step is the round's sole terminal, so a round yields one briefing whose contributors are the crew (the brain is excluded) and whose artifacts are all crew files. Upstream revisions supersede stale queued reports until the terminal work is rerun. The server saves the queue even without a connected browser. Workers return to their desks after handoff; reloads do not replay historical trips.

Donna uses `read_briefing` to read a queued report. A matching browser audio-clock completion marks it presented only after successful, uncancelled speech. Opening a report alone does not consume it; explicit **I've read this briefing** does. Presentation never accepts an assignment. Histories remain available, and interruption leaves reports queued. When a report lands, Donna calls you inside the office. With a voice session connected, `server.ts` starts one announcement turn ("The bakery page is done, Ellis and Miles finished it. Want the short version?", `resultNotice` in `briefings.ts`) once `holdReason` in `briefings.ts` allows it: never while she is generating or the user is speaking; otherwise it waits for her audio to finish, for 6 s after a task-bearing question of hers, for 3 s after the user spoke and for 2.5 s of quiet, and gives up waiting after 10 s. The announcement turn may not call `read_briefing`, so the report stays queued until the user asks for it. With no voice session, the browser rings from its workspace refresh: a chime, a **Calling** badge on the report, **Answer Donna** on the connect button and Donna walking to the entrance phone (no walk under reduced motion). Answering connects with the microphone live and sends the ringing briefing as `start.answer`; Donna opens with her name and that announcement, and reads it only after the user says yes. A call the user starts opens with a greeting ("Hey, it's Donna. What do you need?"). While connected the client shows only Hang up, Hold on and Mute (`call.ts`), typing is a collapsed fallback and board actions are hidden. A whole-utterance goodbye (`hangsUp` in `secretary.ts`) ends the session after Donna's reply has played; Hang up sends `stop`. Phone or other outbound calls outside the office, and unsolicited meeting requests, are future work.

Project settings use local rename/delete/restore endpoints. Deletion pauses active assignments and invalidates late completions before hiding the room. The catalog keeps a tombstone; no workspace, file snapshot or native session is deleted. The model and executor reject writes to deleted projects. Active views and the briefing queue exclude them until restored. Recovery also pauses work when a catalog tombstone was saved before the workspace write.

## Development and production

`AGENCY_DATA_DIR` can select an isolated local data directory for manual UI checks; it defaults to `artifacts/agency`. The live office data is never used as a disposable fixture. `AGENCY_VAD_SILENCE_MS` sets how long Higgs waits after speech before ending the user's turn (default 800 ms; at 550 ms real speech was committed mid-sentence and the voice talked over the user).

`npm run dev` starts API port 3003 and Vite port 5183 from one install. It fails clearly if either port is occupied. Frontend hot reload does not restart the execution server or interrupt active tasks.

`npm run build` type-checks the actual office and builds only its frontend into `dist/web`. `npm start` serves the built UI, API and WebSocket together on loopback port 3003. The old `/agency.html` link remains compatible; `/` is the primary entry. Stop development before starting production on the same port.

## Operations

- **Boot checks** (`npm run doctor`, also run by `npm start`): Node 22.12+ and a writable data directory are fatal (exit 1, server refuses to start). Missing `BOSON_API_KEY`, a default worker engine that is not signed in, or an unavailable Claude Code brain are warnings. One plain line each (`FATAL: …` / `warn: …`) plus a summary.
- **Health:** `GET /agency-api/health` returns `{ok, version:'0.1.0+<sha>', available (Boson key set), engines:{default, codex:{ready,error?}, claude:{ready,error?}, brain:{ready,error?}}, voice:{state:'none'|'connecting'|'ready'|'reconnecting', sessions}, problems:[]}`. Engines are the boot snapshot; `/agency-api/status` stays live.
- **Logs:** `HH:MM:SS [prefix] message` with prefixes `boot`, `voice`, `ws`, `worker`, `brain`, `ring`, `engine`. No raw JSON and no secrets.
- **Voice failures:** a Higgs `upstream_error` is retried once, silently, after 500 ms. A second failure shows the caption "Sorry, say that again?" and a transient `notice` WebSocket event; there is no sticky error.
- **Higgs closes the session** (300 s without user speech, duration cap, network drop, or the server's own rotation after 100 responses): the server emits `voice_state` `reconnecting` with a reason and reconnects lazily on the next user action (typed text, mic audio, answering a briefing, a ring announcement). It re-sends the instructions, office context and the last 12 conversation lines, then emits `voice_state` `ready`. Audio frames arriving during the ~1 s reconnect are dropped.
- **Soak test (paid, real Higgs):** `npm run soak -- --port 3013 [--idle]` starts its own server on a temporary data directory, runs two text turns and checks health; it refuses ports 3003 and 5183. `--idle` also waits for the real 300 s Higgs idle close (up to 400 s), then checks the reconnect, that the conversation carried over, and `ready` health. It prints `SOAK PASS` or `SOAK FAIL: reason`.

## Boundaries kept deliberately small

- New outcomes and project-level decisions belong on the board. Detailed tool traces remain in Codex/Claude.
- Project memory summarizes goals, checkpoints, progress and decisions. It is not an unbounded transcript.
- Provider adapters have a common run/result shape. A staged provider must not be presented as verified.
- Three.js rendering is local. Only six character models and six furniture models are preloaded.
- Historical candidates, music, world-image, GPU scripts and their dependencies are outside the active repository.

There is no pre-created room: rooms are created by work. For a new goal Donna calls `create_project` with a required `initial_work` choice (the goal text, handed to the brain in the same call, or `null` for an intentionally idle room), or calls `delegate_work` with no room and the server does the same from the goal. The name is optional: a placeholder such as "Project 01" is replaced by a short name derived from the brief, and a name already used by an active project gets a " 2", " 3" suffix. The new room is selected server-side and the client is told through a state event. The tool result says planning: no worker exists until the brain's plan is validated. An invalid plan fails the plan step, which can be resumed; nothing is staffed from it. A queued assignment is distinct from a running native session. Asking again for a goal whose brain step is still queued or working (identical text, or a close paraphrase within two minutes) creates nothing and returns that assignment with `alreadyQueued`, so a repeated voice call cannot spawn a duplicate room or plan.

## What replaced what (issue #4)

- Voice-authored staffing plans (team size, briefs, providers, `depends_on` in `delegate_work` / `initial_work`) → the brain plans. Why: the voice model is a poor planner and should only talk; this matches the Python Donna three-tier shape (voice, brain, workers).
- Per-terminal briefings for independent workers → one review briefing per round, written by the brain after reading the files.
- Status answers from raw workspace JSON → one state-derived `progress` sentence per project at the top of the voice context (`workspace.progress`). Live, the JSON-only voice said "still planning" while a worker was running.
- Donna's animation (thinking, working) is driven by brain steps: a working plan step shows her thinking, a working review step shows her working, and the voice's end-of-turn no longer resets it.

## What replaced what (issue #16)

- Read-only brain + JSON plan + one-writer queue for Claude workers → an orchestrator brain with parallel subagents. Why: the old path ran Claude workers one at a time behind a plan the brain could not adjust; the brain now spawns, messages and reviews workers itself. The queue remains for Codex.
- Brain prompts written in TypeScript → two skills (`skills/donna-brain`, `skills/donna-worker`). Why: prompts are prose, editable without touching code; the workspace sends data only, and the worker skill stays office-blind.
- `--restricted` / `--safe-mode` → sandbox + scoped allow rules (`Edit(./**)`, `Write(./**)`, `--setting-sources project`, `--strict-mcp-config`). Why: both flags disable skills; probes showed the sandbox confines Bash writes to the project directory.
- Worker messaging via inbox + hook idea → stdin stream-json injection. Why: a user message reaches a running brain as another user line on its open stdin; the persisted inbox is only the fallback when no brain is running.
