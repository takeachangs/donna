# Chamber

This repository contains the personal office product only. Read `README.md` and `docs/ARCHITECTURE.md` for the current architecture. Historical experiments are not product requirements.

- Active code: `apps/web`, `apps/server/src/agency`, `tests`, `scripts`.
- Do not scan `.history`, `.cache`, `.runtime`, `artifacts` or `node_modules` for general context. Read a specific runtime record only when the task needs it.
- Preserve existing projects, deliverables and native session IDs. Never commit `.env`, runtime data, audio, logs or native execution workspaces.
- Higgs is the secretary; local Codex executes work. Default Codex model is `gpt-6.1-sol`, low reasoning, medium when useful. Use small meaningful acceptance tasks.
- Claude is an optional staged adapter, not connected to the live queue. Do not invoke it unless explicitly requested.
- `npm test` is offline. `npm run test:live` makes paid Higgs calls and uses authenticated Codex; run it only when authorized and report measured usage.
- Keep the UI in English. Add new user-facing copy to both locale files. Preserve the warm neutral palette and readable workboard; avoid floating NPC labels.
- NPC animations must use `transitionTo(...)`, not direct `playAnim(...)`, so movement and state remain consistent.
- `src/vendor/agentshire` and `render/Engine.ts` contain attributed upstream code. Preserve licenses and update `docs/UPSTREAM.md` when changing this boundary.
- Validate with `npm run build`, `npm test`, and `npm run check:repo`. For visual changes, verify the rendered page.
- Source packaging is local. Publishing or pushing a remote repository is a separate action.
