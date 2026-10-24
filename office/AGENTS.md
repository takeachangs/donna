# Chamber office

A display only: it draws `$HIGGS_HOME/office.json` (default `~/.higgs/office.json`) and nothing else. Read `README.md` and `docs/ARCHITECTURE.md` first; the file's contract is `../docs/office-state.md`, and a change to its shape is made on the producer side and in `apps/web/src/agency/types.ts` together.

- Active code: `apps/web`, `apps/server/src/agency`, `tests`, `scripts`. Do not scan `node_modules`, `dist` or `releases`.
- Keep it display only. Do not add endpoints that write, model calls, executors, credentials or git to this directory.
- Keep the UI in English. Add new user-facing copy to both `apps/web/src/i18n/en.ts` and `zh-CN.ts`. Keep the warm neutral palette and the readable drawer; avoid floating NPC labels.
- NPC animations must use `transitionTo(...)`, not direct `playAnim(...)`, so movement and state stay consistent.
- `apps/web/src/vendor/agentshire` and `apps/web/src/render/Engine.ts` contain attributed upstream code. Preserve the licenses and update `docs/UPSTREAM.md` when changing this boundary.
- Never commit secrets, runtime data, logs or `releases/`.
- Validate with `npm test`, `npm run typecheck`, `npm run check:repo` and `npm run build`. For visual changes, verify the rendered page.
- Source packaging is local. Pushing or publishing a repository is a separate action.
