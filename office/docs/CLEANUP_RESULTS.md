# Standalone repository extraction — 2026-10-23

## Result

PASS: Personal Agency now installs, builds and runs without an Agentshire checkout. The root repository is the application repository. No remote publication was performed.

| Check | Result | Evidence |
| --- | --- | --- |
| Clean install | PASS | Copied source alone to a new directory without `.env`, history, data or dependencies; `npm ci` installed 52 packages. |
| Frontend/server type-check and build | PASS | `npm run build`; only the office entries were built. Vite transformed 22 modules. |
| Offline tests | PASS | 33 tests in 5 files, also passed in the clean installation. Covers project preservation, native lifecycle/queue, interruption, secretary transport contract and static serving. Controlled native/voice fixtures are not live inference. |
| Existing projects | PASS | 3 projects, 2 named workers and 2 review assignments remain. Native session references and working directories still exist. |
| Data preservation | PASS | Of 43 pre-existing text/JSON records hashed before cleanup, 42 were unchanged. Only `workspace.json` changed through normal restart/recovery (revision 44 → 45). Room records, delivery files and both usage ledgers were unchanged. |
| Browser demo | PASS | Office and project room render; existing deliverable links remain available. No browser warning/error logs after reload. All 20 model dependency files return HTTP 200 at their expected size. |
| Production serving | PASS | Built `/`, legacy `/agency.html` and microphone worklet return HTTP 200 from the API server. `.env` and private artifact paths return 404. |
| Source boundary | PASS | Allowlisted source, configuration, docs, tests and licensed assets only. Runtime data, secrets, archives and generated output excluded. Known local credential values checked without printing them. |
| Source packaging | PASS | Git-tree ZIP with SHA-256 companion file; package script refuses uncommitted source. No user projects or recordings are included. |
| Live Higgs/Codex regression | UNVERIFIED this cleanup | No paid generation was invoked. Existing earlier live evidence remains private under `artifacts/agency/`. |
| Claude execution | UNVERIFIED | Adapter remains staged/disabled. No Claude command or inference was invoked. |

## Removed from the active architecture

- Complete Agentshire town/server/editor/asset catalogs and the other candidate projects.
- Previous music/world/image generation apps, Python speech environment, GPU scripts and experiment-specific tests.
- Old fixed-three-assistant prompts, meeting scheduler and generation tools; existing room data format remains readable.
- React, React DOM and React build dependencies; the second frontend installation and editor Vite plugin.
- Town input, window screen manager, post-processing, unused catalog/types and unrelated locale strings from the office import graph.

Historical material was moved into ignored `.history/pre-agency-repo-20261023/`, with candidate files in `candidates/` and `candidates-remaining/` because Windows blocked moving the initial candidate root. This was a reversible source cleanup, not a claim that all archived disk space was reclaimed. Current `artifacts/agency/` data stayed in place.

## Scope and remaining limits

The runtime has 23 TypeScript modules: 17 application modules and 6 rendering modules adapted from Agentshire. Model preload fell from 71 to 12. Asset payload is 1,623,609 bytes. Direct runtime dependencies fell from 6 in the previous root manifest to 4; the separate candidate frontend dependency tree is no longer required.

Three.js remains a 585.23 kB minified chunk (148.54 kB gzip), so Vite still emits its 500 kB chunk-size advisory. The application chunk is 79.92 kB (24.98 kB gzip). This cleanup did not change voices, inference providers or visual product design to chase bundle size.

The automated tests passed on this Windows host. The included Linux CI workflow has not yet run on a remote service. The source package is not a backup of native histories or projects; moving existing data across paths/machines requires explicit migration.

## Usage

No new Higgs, Codex generation, Claude, Google or Eleven inference calls were made for cleanup. Existing Higgs and native execution usage ledgers were unchanged. No cloud resources were started or modified. This statement covers this cleanup's actions; it is not a reconciliation of any already-running cloud resource bill.
