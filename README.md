# Donna: a voice secretary for your coding agents

Built at the Higgs Audio Hackathon 2026 (Boson AI, Toronto, Oct 23-24), Track 3 "Agents That Act".

You talk to Donna over Higgs Realtime. If the request is thin she asks one question; otherwise she hands the task to Claude Code running on your machine, which works in git worktrees and dispatches subagents. You keep chatting, interrupt her, or hang up; when a result lands she rings you and speaks it. "Put me through to Maya" opens a fresh session in that worker's voice. A read-only 3D office shows who is working on what.

Higgs Realtime has no client-side delegation, so `higgslive.py` adds it (same shape as the OpenAI Live SDK): tool calls stay open across turns and the agent's answer comes back as the real `function_call_output`.

## Run

macOS, [uv](https://docs.astral.sh/uv/), Claude Code or Codex, and a Boson key. Laptop speakers and mic work (the mic mutes while Donna talks); wired EarPods give you barge-in.

```bash
export BOSON_API_KEY=…
uv run bridge.py --ring --backend session --voice nora --out MacBook --mic MacBook --brain <repo>   # the phone + the brain (tmux attach -t donna)
uv run bridge.py … --brain <repo> --brain-engine codex                                 # Codex edition: brain and workers on Codex CLI (signed in)
cd office && npm install && npm run dev                                                # the office: http://127.0.0.1:5183/
# start the phone once in a terminal, then use the office's Call Donna / Hang up button (Enter in the bridge terminal still works)
```

Checks that need no mic and no credits: `uv run bridge.py selftest`, `uv run higgslive.py`, `uv run herd.py`, `uv run tests/fake_donna.py --demo`.

## Layout

- `higgslive.py`, `bridge.py`: the delegation layer and the mic/speaker app (the voice)
- `herd.py`, `hooks/`, `.claude/skills/call/`: the mailbox, the Claude Code hooks and the `/call` skill (the brain)
- `office/`: the 3D office (display only)
- `docs/demo.md`: demo run sheet and submission draft; `docs/office-state.md`: the one contract between brain and office; `docs/herd.md`: the mailbox; `IDEAS.md`: decision log

## Prior work

Mike (notch app, bridge skeleton, `/call` skill) and Jerrold's Chamber 3D scene (`office/`, adapted) predate the hackathon. The Higgs delegation layer, the herd and brain protocol, the voice, transfer and the hook-fed office state were built Oct 23-24.
