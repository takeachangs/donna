# Donna: a voice secretary for your coding agents

Built at the Higgs Audio Hackathon 2026 (Boson AI, Toronto, Oct 23-24), Track 3 "Agents That Act".

You talk to Donna over Higgs Realtime. If the request is thin she asks one question; otherwise she hands the task to Claude Code running on your machine, which works in git worktrees and dispatches subagents. You keep chatting, interrupt her, or hang up; when a result lands she rings you and speaks it. "Put me through to Maya" opens a fresh session in that worker's voice. A read-only 3D office shows who is working on what.

Higgs Realtime has no client-side delegation, so `higgslive.py` adds it (same shape as the OpenAI Live SDK): tool calls stay open across turns and the agent's answer comes back as the real `function_call_output`.

## Run

macOS, [uv](https://docs.astral.sh/uv/), tmux, Claude Code, wired EarPods, and a Boson key.

```bash
export BOSON_API_KEY=…
uv run bridge.py --ring --backend session --voice nora --out EarPods --brain <repo>   # the phone + the brain (tmux attach -t donna)
uv run bridge.py … --brain <repo> --brain-engine codex                                 # Codex edition: brain and workers on Codex CLI (signed in)
cd office && npm install && npm run dev                                                # the office: http://127.0.0.1:5183/
# start the phone once in a terminal, then use the office's Call Donna / Hang up button (Enter in the bridge terminal still works)
```

Offline checks: `uv run bridge.py selftest`, `uv run higgslive.py`, `uv run herd.py`.

### Windows (Codex brain and workers)

Install Python 3.11+, Node.js 22.12+, Git and the Codex CLI; sign in with `codex login`.
Put `BOSON_API_KEY=...` in a local `.env`, then run from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1
# Or use your repository and an audio device:
# .\start-windows.ps1 -Project C:\projects\my-repo -OutputDevice 'Headphones'
```

The script installs local dependencies, builds the office at http://127.0.0.1:3014/ and opens
the phone in the current terminal. Press Enter to call Donna; say goodbye to end a call.
The default project is an isolated Git repository in `sandbox/`; state lives in `.runtime/donna/`.
Native Windows resumes the same Codex brain when phone tasks or worker results arrive; tmux
and Claude hooks are not required. The brain delegates to named Codex workers and reviews
their files, using the same skill and the upstream brain permission settings. Workers use
`workspace-write`. Model/effort overrides are local to the process (`DONNA_CODEX_MODEL`,
`DONNA_CODEX_EFFORT`); the launcher defaults to Sol with low-effort workers and a medium-effort brain.

`python tests/test_codex.py` checks the worker/office path with a fake CLI. The voice demos
(`tests/fake_donna.py --demo`, including `--engine codex`) still call real Higgs; a fake brain
does not make voice free. The Codex demo also starts real Codex workers. Run live checks only
when authorized. Original local snapshots and native histories are not test fixtures.
Measured Windows acceptance results and usage: [docs/codex-windows-results.md](docs/codex-windows-results.md).

## Layout

- `higgslive.py`, `bridge.py`: the delegation layer and the mic/speaker app (the voice)
- `herd.py`, `hooks/`, `.claude/skills/call/`: the mailbox, the Claude Code hooks and the `/call` skill (the brain)
- `office/`: the 3D office (display only)
- `docs/demo.md`: demo run sheet and submission draft; `docs/office-state.md`: the one contract between brain and office; `docs/herd.md`: the mailbox; `IDEAS.md`: decision log

## Prior work

Mike (notch app, bridge skeleton, `/call` skill) and Jerrold's Chamber 3D scene (`office/`, adapted) predate the hackathon. The Higgs delegation layer, the herd and brain protocol, the voice, transfer and the hook-fed office state were built Oct 23-24.
