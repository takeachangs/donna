# Architecture

Chamber is a local application with one browser client and one Node server. The room scene is a view of real work, not another agent runtime.

## Runtime

1. **Office client — `apps/web/src/agency`**: English room navigation, 3D office, voice playback and interruption, project board, decisions and deliverables. Plain TypeScript and Three.js; no React or town editor.
2. **Secretary — `secretary.ts`, `higgs.ts`, `server.ts`**: one Higgs Realtime conversation interprets speech, reads compact project memory and calls explicit workspace tools. It decides how many workers are useful and their responsibilities. It does not invent completed work.
3. **Workspace — `workspace.ts`, `projects.ts`, `state.ts`**: persisted goals, checkpoints, dependencies, decisions, worker/session references and immutable delivery snapshots. A single queue permits one native writer at a time. `state.ts` only preserves the original room/document storage format; the old three-bot scheduler and tools have been removed.
4. **Execution — `codex.ts`, `executors.ts`, `claude.ts`**: local Codex app-server owns conversation history and execution. Workers name themselves. The app keeps session IDs and concise results, not a duplicate chat store. Claude is registered as a staged adapter but is not enabled in the workspace queue or live-tested.

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

`briefings.ts` reconciles terminal, successful workflow deliveries into immutable saved reports. Intermediate steps pass to their dependents, and the final report includes the dependency chain's file snapshots. Upstream revisions supersede stale queued reports until the terminal work is rerun. The server saves the queue even without a connected browser. Workers return to their desks after handoff; reloads do not replay historical trips.

Donna uses `read_briefing` to read a queued report. A matching browser audio-clock completion marks it presented only after successful, uncancelled speech. Opening a report alone does not consume it; explicit **I've read this briefing** does. Presentation never accepts an assignment. Histories remain available, and interruption leaves reports queued. Outbound calls and unsolicited meeting requests are future work, not simulated features.

Project settings use local rename/delete/restore endpoints. Deletion pauses active assignments and invalidates late completions before hiding the room. The catalog keeps a tombstone; no workspace, file snapshot or native session is deleted. The model and executor reject writes to deleted projects. Active views and the briefing queue exclude them until restored. Recovery also pauses work when a catalog tombstone was saved before the workspace write.

## Development and production

`AGENCY_DATA_DIR` can select an isolated local data directory for manual UI checks; it defaults to `artifacts/agency`. The live office data is never used as a disposable fixture.

`npm run dev` starts API port 3003 and Vite port 5183 from one install. It fails clearly if either port is occupied. Frontend hot reload does not restart the execution server or interrupt active tasks.

`npm run build` type-checks the actual office and builds only its frontend into `dist/web`. `npm start` serves the built UI, API and WebSocket together on loopback port 3003. The old `/agency.html` link remains compatible; `/` is the primary entry. Stop development before starting production on the same port.

## Boundaries kept deliberately small

- New outcomes and project-level decisions belong on the board. Detailed tool traces remain in Codex/Claude.
- Project memory summarizes goals, checkpoints, progress and decisions. It is not an unbounded transcript.
- Provider adapters have a common run/result shape. A staged provider must not be presented as verified.
- Three.js rendering is local. Only six character models and six furniture models are preloaded.
- Historical candidates, music, world-image, GPU scripts and their dependencies are outside the active repository.

For a new project with executable work, Donna supplies a required `initial_work` choice to `create_project`: a staffing plan queues execution in the same tool call; `null` creates an intentionally idle room. Plans are validated before creating the room. Existing idle projects use `delegate_work`. A queued assignment is distinct from a running native session.
