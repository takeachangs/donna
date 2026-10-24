#!/usr/bin/env python3
"""Record a brain run as a replayable office fixture (#65): every Claude Code hook input (raw, plus the command line of the
Claude Code process that fired it, which names a teammate) and every herd line, in time order. tests/office_sync.py replays it.

  record_office_events.py hook <Event>   the hook command: appends the raw input to $HIGGS_HOME/recording.jsonl, then runs herd.hook
  record_office_events.py settings       prints a `claude --settings` JSON registering the above for herd's hook events
  record_office_events.py export OUT     merges recording.jsonl with herd's inbox/outbox/events ($HIGGS_HOME) into OUT
  record_office_events.py run OUT        headless end to end: scratch repo, temp HIGGS_HOME, delegate -> `claude -p` brain
                                         (take, hiring note, 2 background workers, say) -> task.spoken; then export (Sonnet, ~1 min)

Live re-record: start the brain with `claude --settings <(uv run tests/record_office_events.py settings)` (HIGGS_HOME as usual),
make the call, then `uv run tests/record_office_events.py export tests/fixtures/office_run.jsonl`.
"""
import json, os, subprocess, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import herd  # noqa: E402

EVENTS = ["SubagentStart", "SubagentStop", "PostToolUse", "UserPromptSubmit", "Stop", "Notification"]  # = hooks/office.json


def cut(x, n=2000):  # tool outputs can be huge; herd keeps at most 4000 chars of anything
    if isinstance(x, str): return x[:n]
    if isinstance(x, list): return [cut(v, n) for v in x[:50]]
    if isinstance(x, dict): return {k: cut(v, 4000 if k == "prompt" else n) for k, v in x.items()}
    return x


def hook(ev):
    try: d = json.load(sys.stdin)
    except ValueError: return
    try: herd.append(herd.home() / "recording.jsonl", {"t": time.time(), "hook": ev, "data": cut(d), "parent": herd.parent_args().strip()})
    except Exception: pass
    herd.hook(ev, d)


def settings():
    cmd = f"python3 {HERE / 'record_office_events.py'} hook"
    return {"hooks": {e: [{**({"matcher": "*"} if e == "PostToolUse" else {}), "hooks": [{"type": "command", "command": f"{cmd} {e}"}]}] for e in EVENTS}}


def export(out):
    h, dd = herd.home(), herd.root() / "donna"
    steps = [{"t": r["t"], "hook": r["hook"], "data": r["data"], "parent": r.get("parent", "")} for r in herd.tail(h / "recording.jsonl", 1 << 30)]
    meta = herd.rj(dd / "meta.json")
    steps += [{"t": m["ts"], "send": {"tid": m["id"], "task": m["task"], **({"reply_to": m["in_reply_to"]} if m.get("in_reply_to") else {})}}
              for m in herd.tail(dd / "inbox.jsonl", 1 << 30) if m.get("ts", 0) >= meta.get("since", 0)]
    steps += [{"t": o["ts"], "reply": {"tid": o["id"], "kind": o["kind"], "text": o.get("text") or ""}} for o in herd.tail(dd / "outbox.jsonl", 1 << 30)]
    steps += [{"t": e["ts"], "spoken": e["id"]} for e in herd.tail(herd.root() / "events.jsonl", 1 << 30) if e.get("ev") == "task.spoken"]
    steps.sort(key=lambda s: s["t"])
    t0 = steps[0]["t"] if steps else 0
    with open(out, "w") as f:
        f.write(json.dumps({"project": meta.get("project"), "recorded": time.strftime("%Y-%m-%d %H:%M")}) + "\n")
        for s in steps: f.write(json.dumps({**s, "t": round(s["t"] - t0, 3)}) + "\n")
    print(f"{len(steps)} steps -> {out}")


def run(out):
    tmp = Path(tempfile.mkdtemp(prefix="office-rec-"))
    repo, hh = tmp / "repo", tmp / "hh"
    repo.mkdir(); hh.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    (repo / "README.md").write_text("scratch\n")
    os.environ["HIGGS_HOME"] = str(hh)
    herd.new("donna", project=str(repo))
    tid = herd.send("donna", "make a tiny landing page: index.html and style.css")  # the voice's delegate_task
    (tmp / "settings.json").write_text(json.dumps(settings()))
    r = f"uv run -q {HERE.parent / 'herd.py'} reply donna {tid}"
    prompt = f"""You are Donna's brain in a recorded test run. Phone task {tid}: make a tiny landing page: index.html and style.css.
Do exactly this, in order, each herd command as its own Bash call:
1. {r} take ""
2. {r} note "Hiring Ava for the page and Ben for the styling"
3. In ONE message, two Agent tool calls, both run_in_background true, model "sonnet":
   name "Ava", description "Writes the page", prompt "Write {repo}/index.html: a 10-line HTML page titled Hello that links style.css. Then reply with one line.";
   name "Ben", description "Writes the styles", prompt "Write {repo}/style.css: 5 lines of CSS for a centered heading. Then reply with one line."
4. Wait for both reports; do not poll.
5. {r} say "Ava wrote the page and Ben the styles."
Then stop."""
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    subprocess.run(["claude", "-p", "--settings", str(tmp / "settings.json"), "--permission-mode", "auto", "--model", "sonnet", prompt],
                   cwd=repo, env=env, check=True, timeout=600)
    herd.event("task.spoken", "donna", id=tid)  # the voice says the result
    export(out)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["hook"] and len(a) == 2: hook(a[1])
    elif a == ["settings"]: print(json.dumps(settings()))
    elif a[:1] == ["export"] and len(a) == 2: export(a[1])
    elif a[:1] == ["run"] and len(a) == 2: run(a[1])
    else: sys.exit(__doc__)
