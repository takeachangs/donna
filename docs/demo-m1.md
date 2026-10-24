# M1 demo: Donna picks up the phone

Two processes: Donna (a Claude Code session running `/call`) and the phone (`bridge.py --ring`). They meet in
`~/.higgs/herd/donna/` and log to `~/.higgs/herd/events.jsonl`. Design: `docs/herd.md` §3–§6.

## Once
- `BOSON_API_KEY` exported (`~/.zshrc`).
- Optional, so tasks reach Donna mid-work: add the PostToolUse hook from `docs/herd.md` §6 to `.claude/settings.json`
  of the folder Donna runs in (or pass that JSON to `claude --settings`).

## Start, in order
1. A terminal for the event log (the scene reads the same lines):
   ```bash
   tail -n 0 -F ~/.higgs/herd/events.jsonl
   ```
2. Donna. In the folder she should work in, start Claude Code and type `/call`:
   ```bash
   cd ~/projects/higgs-hackathon && claude
   ```
   Expected: she says she is on duty; the log shows `{"ev": "agent.state", "agent": "donna", "state": "idle"}`.
   `~/.higgs/herd/donna/meta.json` `project` is that folder (the hook matches on it).
3. The phone (Donna starts it herself in skill step 4 when asked; by hand it is):
   ```bash
   cd ~/projects/higgs-hackathon && uv run bridge.py --ring --backend session --voice nora --out AirPods
   ```
   Expected in `bridge.log`: `ring: waiting — Enter to call Donna`. Enter calls her; otherwise nothing happens until
   she has a result.

## Run it
4. Give Donna work from any shell (or tell her in her session, or on the phone):
   ```bash
   uv run herd.py send donna "create notes.txt with today's date in it"
   ```
   Expected events: `task.sent` → `agent.state working` → `task.note` → `task.done` → `agent.state idle` →
   `call.ring` → `call.answered` → `agent.state on_call` → `voice.speaking`. `bridge.log`:
   ```
   event call.ring {'about': "Done. Notes.txt is created in the project folder with today's date, October 23rd, 2026."}
   event call.answered
   session ready (backend: session)
   VOICE (5.6s, 173 wpm): Just wanted to confirm that Notes.txt is all set in the project folder with today's date.
   ```
5. During the call, ask for something ("how many lines does it have?"). Expected: `DELEGATION call_…` in `bridge.log`,
   a `task.sent` with `"from": "voice"` and the same id, Donna works, her `say` is spoken in the same call. A task sent
   with `herd.py send` while the call is live is also spoken in the call (`VOICE: Just got the update: …`); if the call
   has already ended, it rings again.
6. "How's it going?" is answered from the herd (`task_status → …` in `bridge.log`), not by interrupting Donna.

## Hang up, stop
- Hang up: say "bye" (or "that's all"), or stay quiet for 60 s. Expected: `call.ended` with `reason` `goodbye` or
  `silence`, then `ring: waiting` again. The phone stays on.
- Stop the phone: Ctrl-C in its terminal, or `pkill -f "bridge.py --ring"` (also hangs up a live call).
- Stop Donna: tell her "stop" (she stops waiting and summarizes), then quit Claude Code.

## Headless check (no mic, what the PR ran)
```bash
uv run bridge.py --ring --silent --backend session            # background; the voice "speaks" into bridge.log only
claude --bg --name donna-e2e --permission-mode auto "/call"   # Donna
uv run herd.py send donna "create notes.txt with today's date in it"
claude stop <id>; pkill -f "bridge.py --ring"                  # when call.ended reason=silence is in the log
```
