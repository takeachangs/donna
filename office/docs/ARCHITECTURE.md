# Architecture

The office is a display. It reads one JSON file, streams it to a browser and draws it. Nothing in `office/` writes that file, calls a model or runs git. The voice is `bridge.py`, Donna's brain is the user's own Claude Code session running `/call`, and the workers are whatever that session spawns; the brain-side producer writes the file. The file's shape and the producer's sources are in [`../../docs/office-state.md`](../../docs/office-state.md).

## Server (`apps/server/src/agency`)

`server.ts` listens on `127.0.0.1:$AGENCY_PORT` (default 3003) and rejects a request whose `Origin` header is present and not `http://127.0.0.1:<port>` or `http://localhost:<port>`. It has four routes and no POST endpoint:

- Static files from `dist/web` (`static.ts`; only the built frontend is served, never the repository).
- `GET /agency-api/health` returns `{ok, version, state, updated}`; `state` is `file` or `missing`, `updated` is the file's mtime.
- `GET /agency-api/workspace` returns the current workspace.
- `/agency-ws` sends `{type: 'workspace', workspace}` on connect and again on every change. Clients send nothing; incoming messages are capped at 1 KiB.

## Data (`state.ts`)

The file is `$HIGGS_HOME/office.json`, with `HIGGS_HOME` defaulting to `~/.higgs`. The writer renames a temp file over it, so `fs.watch` is set on the directory, not the file, and a 1 s poll covers a directory that does not exist yet or a missed event. The text is compared with the last read, so an unchanged file broadcasts nothing.

A file that is missing, unparseable or not a JSON object gives the empty workspace: Donna alone, no rooms, `call.state` `off`, health `state: 'missing'`. A valid object has missing lists, secretary or call filled from the empty workspace. Nothing else is validated; the types in `apps/web/src/agency/types.ts` are the contract.

## Web (`apps/web/src/agency/main.ts`)

The page connects to `/agency-ws`, replaces its workspace on each message and reconnects with backoff (1 s doubling, 15 s cap), showing Reconnecting while the server is away. It draws, and never sends.

- Status line (where the call bar was): `call.state` as Off the line, Donna is calling you, Listening, Thinking or Speaking. Ringing sends Donna to the entrance phone; speaking and thinking animate her.
- Drawer: needs-you cards from open decisions, reports (unread first, with a replay of the handoff walk), recent activity, and for a selected room its memory, work and reports. A work item opens a details dialog with its brief, summary and the worker's latest action.
- The file has no `briefing.workerId`. `adapt()` sets it from the first contributor's name, so the scene's handoff walk still finds a worker.
- User-facing copy is English, in `apps/web/src/i18n/en.ts` and `zh-CN.ts`.

## Scene (`Scene.ts`, `floor.ts`)

Three.js, unchanged by the cut. `floor.ts` lays out the floor: a doorway per project onto the shared hall, Donna's suite at the entrance, rooms growing outward as teams grow.

- Lounge rule (`resting` in `floor.ts`): a non-lead worker whose status is `done` or `failed` sits in the lounge on their own, whatever the rest of the project is doing. A worker with a new report walks to Donna first, then rests.
- Handoff walk: when a `queued` briefing appears that the scene has not seen, its worker (not currently `working`) walks desk to Donna, and on to the lounge if resting. Briefings present at load do not walk, and reduced motion skips the animation.
- Donna's tool-call errands (`Scene.toolTrip`, with the planner `errand`, `turnBack` and `nextCall` in `floor.ts`) were driven by voice tool events. Those events no longer exist and nothing calls `toolTrip`; the planner is still unit-tested.
- NPC animation changes go through `transitionTo(...)`.

## Boundaries

- Display only: no state, prompts, executors, credentials or git live here. To change what the office shows, change the producer and the shared contract, not this directory.
- The server binds to loopback and rejects other origins.
- `scripts/check-repo.mjs` limits the source package to allowlisted paths; the Agentshire-derived rendering code is listed in [UPSTREAM.md](UPSTREAM.md).
- `npm run dev` runs this server on 3003 and Vite on 5183, and fails if either port is taken. `npm run build` type-checks and builds `dist/web`; `npm start` serves it.
