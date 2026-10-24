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

- `projects.json`: project catalog.
- `workspace.json`: secretary identity, project memory, assignments, decisions and activity.
- `rooms/`: compatible existing project records and old documents.
- `workspaces/`: actual native execution directories.
- `deliveries/`: versioned file snapshots for review.
- `calls.jsonl`, `executions.jsonl`, `audio/`: usage evidence and retained speech.

Existing native workspaces can contain absolute paths. Keep this directory in place during source refactors. Moving an existing installation to a different machine/path needs an explicit workspace-path migration; the source ZIP is not a user-data backup.

## Development and production

`npm run dev` starts API port 3003 and Vite port 5183 from one install. It fails clearly if either port is occupied. Frontend hot reload does not restart the execution server or interrupt active tasks.

`npm run build` type-checks the actual office and builds only its frontend into `dist/web`. `npm start` serves the built UI, API and WebSocket together on loopback port 3003. The old `/agency.html` link remains compatible; `/` is the primary entry. Stop development before starting production on the same port.

## Boundaries kept deliberately small

- New outcomes and project-level decisions belong on the board. Detailed tool traces remain in Codex/Claude.
- Project memory summarizes goals, checkpoints, progress and decisions. It is not an unbounded transcript.
- Provider adapters have a common run/result shape. A staged provider must not be presented as verified.
- Three.js rendering is local. Only six character models and six furniture models are preloaded.
- Historical candidates, music, world-image, GPU scripts and their dependencies are outside the active repository.
