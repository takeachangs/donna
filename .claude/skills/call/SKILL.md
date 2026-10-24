---
name: call
description: Start a voice call where Higgs Realtime handles the mic and speaker and THIS agent session does the work. Use when the person types /call or asks to talk to this session by voice. Works from Claude Code, Codex, or any agent with a shell.
---
# /call — voice front end, this agent session as the brain

`~/projects/higgs-hackathon/bridge.py` runs the voice (Higgs Realtime, through the `higgslive.py` delegation layer). When
the person asks the voice for something that needs doing, the voice writes one JSON line to `~/.higgs/inbox.jsonl`:
`{"id": "…", "task": "…", "context": "last few turns of the call"}`. You do the task here, in this session, in this
project, and reply through two shell commands. The voice keeps chatting with the person while you work. Nothing here is
specific to one coding agent: you need a shell, a way to wait on a file, and the two commands below.

## Steps
1. Write `~/.higgs/context.txt` so the voice knows what this chat is working on: a few plain sentences on the current task
   (what is open, which step you reached) and any short facts the voice may answer without asking you. Under 4000
   characters. If YOU are placing the call (the person said yes to your offer rather than typing `/call`), make the first
   line `Calling about: <one short reason>`; the voice then opens by saying it. Otherwise leave that line out and the voice
   waits to be spoken to.
2. Start the voice in the background and wait for `session ready` in its log:
   ```bash
   cd ~/projects/higgs-hackathon && (nohup uv run -q bridge.py --backend session --voice nora --out AirPods > /dev/null 2>&1 < /dev/null &); sleep 3; tail -2 bridge.log
   ```
   Tell the person the call is live and that they can talk now.
3. Wait for the next task. This command blocks until a new inbox line arrives, then prints it:
   ```bash
   n=$(wc -l < ~/.higgs/inbox.jsonl 2>/dev/null || echo 0); until [ "$(wc -l < ~/.higgs/inbox.jsonl 2>/dev/null || echo 0)" -gt "$n" ]; do sleep 1; done; tail -n1 ~/.higgs/inbox.jsonl
   ```
   Claude Code: run it with `run_in_background: true` and you are notified when it exits. Codex or another agent: run it
   as a normal command with a long timeout (ten minutes or more); it returns when the person asks for something. Either
   way, run it again after every task.
4. For each inbox line:
   - Send a quiet progress note as soon as you know what you're doing, and at each real step (the voice only mentions these if asked):
     `uv run ~/projects/higgs-hackathon/bridge.py note <id> "reading the config"`
   - Do the task here. Read-only unless the task clearly asks for a change; the project's own rules file still applies.
   - Reply with the spoken result, at most three plain sentences for a voice to say — facts, status, next step; no code, no paths, no markdown:
     `uv run ~/projects/higgs-hackathon/bridge.py say <id> "Done. The clock page is written and open in your browser."`
   - If the task needs a decision or a destructive change, `say` what you would do and ask; act only after the person says yes on the call (that arrives as a new task).
5. The person hangs up with Ctrl-C in the voice log or by stopping it: `pkill -f bridge.py`. Then stop waiting, delete
   `~/.higgs/context.txt`, and give a two-line summary of what was asked and done.

## Notes
- `~/.higgs/` holds `inbox.jsonl`, `outbox.jsonl` and `context.txt`; `bridge.log` in the hackathon folder is the voice's log (every turn, timestamps).
- Audio: laptop mic in, AirPods out (`--out AirPods`). Make sure the AirPods are connected to the Mac; if the person hears nothing, use `--out Speakers`.
- The voice is billed per minute; don't start a call unless asked. The voice hangs up by itself after 5 minutes with no speech from the person.
- Without a live session, `bridge.py --backend claude` or `--backend codex` runs the agent's headless CLI in `--project` instead.
