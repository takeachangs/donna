# Chamber office

A read-only 3D office that draws what Donna's brain is doing. Each project is a room on a shared floor; workers sit at desks, finished reports go to Donna, and a status line shows the phone call (off the line, ringing, listening, thinking, speaking). The office has no voice, no model and no git. A Node server watches one JSON file, `~/.higgs/office.json`, and streams it to the page. The writer is outside this directory: see [`../docs/office-state.md`](../docs/office-state.md) for the file's shape and who produces it.

## Run

Needs Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5183/. With no file the office shows Donna alone, off the line. `HIGGS_HOME` picks the folder that holds `office.json` (default `~/.higgs`). To try it without the real producer, write a small file in a scratch folder and start the server with that folder:

```sh
mkdir -p /tmp/office-try && cat > /tmp/office-try/office.json <<'JSON'
{
  "revision": 1,
  "call": { "state": "ringing" },
  "projects": [{ "id": "demo", "name": "demo", "goal": "Try the office" }],
  "workers": [{ "id": "w1", "projectId": "demo", "name": "Ellis", "role": "Builder", "responsibility": "",
                "characterKey": "char-male-b", "status": "working", "currentAction": "Edit app.py" }],
  "assignments": [{ "id": "a1", "projectId": "demo", "workerId": "w1", "title": "Build the page",
                    "brief": "A demo task", "acceptance": "", "status": "working", "cwd": "/tmp" }]
}
JSON
HIGGS_HOME=/tmp/office-try npm run dev
```

Edit the file while the page is open and it redraws within about a second. A missing or invalid file shows the empty office.

## What the page shows

- The floor: Donna's suite at the entrance, one room per project, one desk per worker. Click a room or a person to open it.
- A status line at the top: Off the line, Donna is calling you, Listening, Thinking, Speaking. While it rings Donna walks to the entrance phone.
- A drawer on the right: open questions ("needs you"), reports (unread first), recent activity, and per room the latest memory and its work with a details dialog. Everything in it is read-only.
- When a new unread report arrives, its first contributor walks from their desk to Donna, then to the lounge. A finished worker (done or failed) rests in the lounge on their own, whatever the rest of the project is doing.

## Verify

```sh
npm test
npm run typecheck
npm run check:repo
npm run build
```

`check:repo` checks the source boundary: only allowlisted paths, no symlinks, no runtime data or logs, and no credential values.

## Production

```sh
npm run build
npm start
```

One process serves the built UI, `GET /agency-api/health`, `GET /agency-api/workspace` and the `/agency-ws` WebSocket on http://127.0.0.1:3003/. `AGENCY_PORT` changes the port for `npm start` (`npm run dev` always uses 3003 for the API and 5183 for Vite). The server listens on loopback only and refuses non-local origins.

## Source and licenses

```text
apps/web/src/agency/      Page, scene, floor layout
apps/web/src/render/      Render loop (adapted from Agentshire)
apps/web/src/vendor/      Adapted Agentshire NPC and world code
apps/server/src/agency/   File watcher, HTTP and WebSocket server
tests/ scripts/ docs/     Offline tests, dev launcher and packaging, architecture and provenance
```

`npm run package:source` zips the committed tree into ignored `releases/` and refuses a dirty tree. It never publishes anything.

The office uses a small attributed subset of [Agentshire](https://github.com/Agentshire/Agentshire) (MIT): the NPC, world and asset-loading modules under `apps/web/src/vendor/agentshire` and the reduced `apps/web/src/render/Engine.ts`. Characters are Kenney Mini Characters and furniture is KayKit Furniture Bits, both CC0. Preserve those licenses; see [upstream comparison](docs/UPSTREAM.md), [third-party notices](THIRD_PARTY_NOTICES.md) and [architecture](docs/ARCHITECTURE.md). Original code here is marked `UNLICENSED` in `package.json`.
