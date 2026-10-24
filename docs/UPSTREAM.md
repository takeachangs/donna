# Relationship to Agentshire

Upstream: https://github.com/Agentshire/Agentshire

Pinned source commit: `f54a798ac94d5138fd8d0ed94c48a1c7e494987c` (`Update README.md`).

## What is ours

The product workflow is independent: Higgs secretary, dynamic staffing, worker naming, native Codex execution/resume, staged Claude adapter, serialized work queue, project memory, decisions, delivery snapshots, room navigation, workboard, voice playback and office arrangement were added for Personal Agency. The current server is not an Agentshire server fork.

## What we retain

| Upstream file | Current location | Adaptation |
| --- | --- | --- |
| `engine/Engine.ts` | `apps/web/src/render/Engine.ts` | Reduced to render loop, scene lifecycle, container resize and visibility pause. Removed town input, screen manager, post-processing and unused utilities. |
| `engine/World.ts` | `apps/web/src/vendor/agentshire/World.ts` | Scene/light helpers, attribution header. |
| `npc/NPC.ts` | `apps/web/src/vendor/agentshire/NPC.ts` | Preserved animation state machine; local imports and default character selection. |
| `npc/NPCManager.ts` | `apps/web/src/vendor/agentshire/NPCManager.ts` | Local imports; infer constructor config instead of importing town-wide types. |
| `npc/StatusIndicator.ts` | `apps/web/src/vendor/agentshire/StatusIndicator.ts` | Retained visual status implementation. |
| `game/visual/AssetLoader.ts` | `apps/web/src/vendor/agentshire/AssetLoader.ts` | Preload manifest reduced to six characters and six furniture models. |

All upstream paths above are relative to `town-frontend/src/`. The MIT notice is retained. Generic model-loading/animation methods inside this small vendor subset are retained to avoid a risky rewrite; the town, external asset catalogs and editor are not included.

## Measured scope, 2026-10-23

- The pinned upstream frontend contains **186 tracked source-tree files**, including **155 TypeScript files**.
- Before extraction, this office entry imported **23 files** transitively and preloaded **71 models** from the candidate checkout.
- The independent runtime contains **23 TypeScript modules**: **17 application modules** and **6 derived rendering modules**. Build configuration, tests and scripts are counted separately.
- Only **6 of the upstream's 155 TypeScript files** are retained/adapted (3.9% by file count). This is a reuse-scope metric, **not** a claim that 96.1% of the application was rewritten or an authorship percentage.
- The office now preloads **12 models**, backed by **20 asset files / 1,623,609 bytes** including buffers and shared textures.
- One root dependency lock replaces the candidate frontend's second install. Runtime direct dependencies: **dotenv, three, ws, zod**. No React, Tailwind, editor plugin, world-image service or cloud GPU is needed by this app.
- Before extraction, the upstream tracked diff showed four edited files, with the actual office implementation mostly in untracked new files. A normal `git diff --stat` therefore understated the product divergence. This report includes those additions.

`upstream-manifest.json` records source mappings, upstream source hashes and asset hashes. The six character GLBs and texture match Kenney's official archive. Furniture buffers/atlas match KayKit's official repository; the six glTF documents match after normalizing relative URI paths. The corrected asset credits are in `THIRD_PARTY_NOTICES.md`.

## Updating later

Treat this as a standalone product with a small vendored rendering dependency. Do not merge the whole town app to obtain an NPC fix. Review relevant upstream changes, port the specific rendering fix, update the source pin/mapping if needed, and verify character animation, resize, room selection and the board. Keep native execution and project memory independent of the renderer.
