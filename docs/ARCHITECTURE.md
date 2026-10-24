# Architecture

Chamber is a local application with one browser client and one Node server. The room scene is a view of real work, not another agent runtime.

## Runtime

1. **Office client — `apps/web/src/agency`**: English room navigation, 3D office, voice playback and interruption, project board, decisions and deliverables. Plain TypeScript and Three.js; no React or town editor.
2. **Secretary voice — `secretary.ts`, `higgs.ts`, `server.ts`**: one Higgs Realtime conversation interprets speech, reads compact project memory and calls explicit workspace tools. It passes the user's goal on and never staffs: team size, roles and engines are not its decision. It does not invent completed work.
3. **Brain — `workspace.ts` brain steps, `plans.ts` contract, `executors.ts` brain adapter**: Donna's brain is a per-project, persistent, read-only Claude Code lead session (`claude --resume`, tools Read, Glob, Grep only, model `AGENCY_BRAIN_MODEL`, default opus). Plan → staff → review → one briefing: it reads the project and returns a JSON plan of 1–4 workers; the workspace runs them through the one-writer queue; when all have delivered, the brain is re-invoked to review the files and write the summary. Brain steps are ordinary assignments with `kind: 'plan' | 'review'`, owned by a per-project lead worker (`lead: true`, the secretary's name, role Lead) whose status mirrors the current step. Lead workers get no desk.
4. **Workspace — `workspace.ts`, `projects.ts`, `state.ts`**: persisted goals, checkpoints, dependencies, decisions, worker/session references and immutable delivery snapshots. A single queue permits one native writer at a time. `state.ts` only preserves the original room/document storage format; the old three-bot scheduler and tools have been removed.
5. **Execution — `codex.ts`, `executors.ts`, `claude.ts`**: the native engine owns conversation history and execution: local Codex app-server by default, or Claude Code (`claude --print`, stream-json) when the brain's plan sets `provider: "claude"` on a worker. Without a named engine `AGENCY_DEFAULT_PROVIDER` applies; unset, Codex when signed in, else Claude Code. Workers name themselves. The app keeps session IDs and concise results, not a duplicate chat store. A worker stays bound to its engine's session; reuse across engines is rejected. The single queue still runs one native writer at a time across both engines.

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

Project tools accept `project_id: "selected"` so the secretary does not need to reconstruct UUIDs for the current room. Explicit unknown IDs are rejected, never silently redirected. Identical failed tool retries stop with a visible error; the total tool-round limit also reports an error rather than appearing to finish successfully.

Existing native workspaces can contain absolute paths. Keep this directory in place during source refactors. Moving an existing installation to a different machine/path needs an explicit workspace-path migration; the source ZIP is not a user-data backup.

## Floor and result handoff

The Office floor is the global view (the internal `command` view identifier remains compatible). `floor.ts` gives each project a stable doorway onto the shared hall; growing a team expands its room outward, and new projects add rows. Donna's suite stays at the entrance. `Scene.ts` renders this persisted workspace and animates new deliveries; animation never commits completion or controls execution.

`briefings.ts` reconciles terminal, successful workflow deliveries into immutable saved reports. Intermediate steps pass to their dependents, and the final report includes the dependency chain's file snapshots. The review step is the round's sole terminal, so a round yields one briefing whose contributors are the crew (the brain is excluded) and whose artifacts are all crew files. Upstream revisions supersede stale queued reports until the terminal work is rerun. The server saves the queue even without a connected browser. Workers return to their desks after handoff; reloads do not replay historical trips.

Donna uses `read_briefing` to read a queued report. A matching browser audio-clock completion marks it presented only after successful, uncancelled speech. Opening a report alone does not consume it; explicit **I've read this briefing** does. Presentation never accepts an assignment. Histories remain available, and interruption leaves reports queued. When a report lands, Donna calls you inside the office. With a voice session connected, `server.ts` starts one announcement turn ("The review for X is ready; want it now?") once `holdReason` in `briefings.ts` allows it: never while she is generating or the user is speaking; otherwise it waits for her audio to finish, for 6 s after a task-bearing question of hers, for 3 s after the user spoke and for 2.5 s of quiet, and gives up waiting after 10 s. The announcement turn may not call `read_briefing`, so the report stays queued until the user asks for it. With no voice session, the browser rings from its workspace refresh: a chime, a **Calling** badge on the report, **Answer Donna** on the connect button and Donna walking to the entrance phone (no walk under reduced motion). Answering connects and presents that report first. Phone or other outbound calls outside the office, and unsolicited meeting requests, are future work.

Project settings use local rename/delete/restore endpoints. Deletion pauses active assignments and invalidates late completions before hiding the room. The catalog keeps a tombstone; no workspace, file snapshot or native session is deleted. The model and executor reject writes to deleted projects. Active views and the briefing queue exclude them until restored. Recovery also pauses work when a catalog tombstone was saved before the workspace write.

## Development and production

`AGENCY_DATA_DIR` can select an isolated local data directory for manual UI checks; it defaults to `artifacts/agency`. The live office data is never used as a disposable fixture. `AGENCY_VAD_SILENCE_MS` sets how long Higgs waits after speech before ending the user's turn (default 800 ms; at 550 ms real speech was committed mid-sentence and the voice talked over the user).

`npm run dev` starts API port 3003 and Vite port 5183 from one install. It fails clearly if either port is occupied. Frontend hot reload does not restart the execution server or interrupt active tasks.

`npm run build` type-checks the actual office and builds only its frontend into `dist/web`. `npm start` serves the built UI, API and WebSocket together on loopback port 3003. The old `/agency.html` link remains compatible; `/` is the primary entry. Stop development before starting production on the same port.

## Boundaries kept deliberately small

- New outcomes and project-level decisions belong on the board. Detailed tool traces remain in Codex/Claude.
- Project memory summarizes goals, checkpoints, progress and decisions. It is not an unbounded transcript.
- Provider adapters have a common run/result shape. A staged provider must not be presented as verified.
- Three.js rendering is local. Only six character models and six furniture models are preloaded.
- Historical candidates, music, world-image, GPU scripts and their dependencies are outside the active repository.

For a new project with executable work, Donna supplies a required `initial_work` choice to `create_project`: the goal text, handed to the brain in the same tool call, or `null` for an intentionally idle room. Existing projects use `delegate_work` with a goal. The tool result says planning: no worker exists until the brain's plan is validated. An invalid plan fails the plan step, which can be resumed; nothing is staffed from it. A queued assignment is distinct from a running native session.

## What replaced what (issue #4)

- Voice-authored staffing plans (team size, briefs, providers, `depends_on` in `delegate_work` / `initial_work`) → the brain plans. Why: the voice model is a poor planner and should only talk; this matches the Python Donna three-tier shape (voice, brain, workers).
- Per-terminal briefings for independent workers → one review briefing per round, written by the brain after reading the files.
- Status answers from raw workspace JSON → one state-derived `progress` sentence per project at the top of the voice context (`workspace.progress`). Live, the JSON-only voice said "still planning" while a worker was running.
- Donna's animation (thinking, working) is driven by brain steps: a working plan step shows her thinking, a working review step shows her working, and the voice's end-of-turn no longer resets it.
