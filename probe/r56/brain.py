# /// script
# dependencies = []
# ///
"""#56: a real headless brain on the /call skill of THIS checkout. uv run probe/r56/brain.py MODEL OUTDIR [thin]   (MODEL: sonnet, opus, ...)
A scratch git repo (a tiny CLI, a finished website on branch donna/website), a temp HIGGS_HOME, one `claude -p` brain with the
office hooks; tasks sent one at a time through herd.send, as the voice would (a one-turn transcript): five "dispatch an agent
to make X" (the first one's work exists already: the Oct 24 10:38 case), then three that repeat finished work without asking for
anyone. An `ask` gets "Your call, go ahead." Measured from $HIGGS_HOME: per task the seconds to take / first note naming a
worker / say, the brain's named Agent spawns and their briefs (worktree), and every Write/Edit the brain made itself (hook log,
PostToolUse without an agent id). Never touches ~/.higgs or tmux `donna`: HIGGS_HOME is set for this process and the brain."""
import json, os, subprocess, sys, tempfile, time
HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL, OUT = sys.argv[1], os.path.abspath(sys.argv[2])
TASKS = [("Dispatch an agent to come up with a really nice website to describe the project.", "Can you dispatch an agent to come up with a really nice website to describe the project?"),
         ("Get an agent to add a --version flag to the CLI.", "Get an agent to add a version flag to the CLI."),
         ("Have someone write a short CONTRIBUTING guide.", "Have someone write a short contributing guide."),
         ("Dispatch an agent to make a small HTML hydration calculator page.", "Dispatch an agent to make a little HTML page that calculates hydration."),
         ("Get someone to fix the typo in the README's first line.", "Get someone to fix the typo in the first line of the README."),
         ("Make a website that describes the project.", "Make a website that describes the project."),
         ("Add a version flag to the CLI.", "Add a version flag to the CLI."),
         ("Fix the README typo.", "Fix the typo in the README.")]
THIN = [("Get an agent to make something fun for the kids.", "Can you get an agent to make something fun for the kids?"),
        ("Improve it.", "Hmm. Can you improve it?")]   # thin: one ask with a proposal first, then (after "Your call, go ahead.") a named worker
if sys.argv[3:4] == ["thin"]: TASKS = THIN
OVER = "REHEARSAL OVER"
PROMPT = (f"Read {HERE}/.claude/skills/call/SKILL.md and follow it: you are Donna's brain. Rehearsal rules, overriding the skill where they "
          "differ: there is no voice and no phone, so never run step 4 or step 5 and never start or stop bridge.py. When an inbox line's "
          f"task is exactly '{OVER}', reply nothing to it, do not run the wait loop again, and end with one line.")


def repo(root):
    r = os.path.join(root, "kneadle"); os.makedirs(r)
    files = {"README.md": "# Kneadle: a dough hydraton calculator\n\nA tiny command-line tool: `python3 kneadle.py FLOUR WATER` prints the hydration.\n\nChecks: `python3 test_kneadle.py`\n",
             "kneadle.py": 'import sys\n\n\ndef hydration(flour, water):\n    return round(100 * water / flour, 1)\n\n\nif __name__ == "__main__":\n    f, w = map(float, sys.argv[1:3])\n    print(f"{hydration(f, w)}%")\n',
             "test_kneadle.py": "from kneadle import hydration\nassert hydration(500, 350) == 70.0\nprint('ok')\n"}
    for n, t in files.items(): open(os.path.join(r, n), "w").write(t)
    git = lambda *a: subprocess.run(["git", "-C", r, *a], check=True, capture_output=True)
    git("init", "-q", "-b", "main"); git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "kneadle")
    git("checkout", "-qb", "donna/website"); os.makedirs(os.path.join(r, "site"))
    open(os.path.join(r, "site", "index.html"), "w").write("<!doctype html><title>Kneadle</title><h1>Kneadle</h1><p>A dough hydration calculator for bakers.</p>\n")
    git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "website describing the project"); git("checkout", "-q", "main")
    return r


def jl(p):
    out = []
    for l in open(p) if os.path.exists(p) else []:
        try: out.append(json.loads(l))
        except ValueError: pass   # the brain's stderr shares its stream log
    return out


def main():
    os.makedirs(OUT, exist_ok=True); root = tempfile.mkdtemp(prefix=f"run-{MODEL}-{len(TASKS)}-", dir=OUT)   # kept: the scratch repo, its worktrees and the herd files
    h = os.path.join(root, "home"); os.makedirs(h)
    os.environ["HIGGS_HOME"] = h; sys.path.insert(0, HERE); import herd   # herd reads HIGGS_HOME per call; send's tmux wake targets donna-<dir>, never `donna`
    r = repo(root); env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}   # the claude.ai login, not the low-credit key
    tag = MODEL + "-thin" * (TASKS is THIN); log = open(os.path.join(OUT, f"stream-{tag}.jsonl"), "w")
    brain = subprocess.Popen(["claude", "-p", PROMPT, "--model", MODEL, "--settings", os.path.join(HERE, "hooks", "office.json"), "--add-dir", HERE,
                              "--permission-mode", "auto", "--output-format", "stream-json", "--verbose"], cwd=r, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    meta, t0 = os.path.join(h, "herd", "donna", "meta.json"), time.time()
    while time.time() - t0 < 180 and not (os.path.exists(meta) and json.load(open(meta)).get("session")
                                          and any("until [" in json.dumps(e.get("input")) for e in jl(os.path.join(h, "events.jsonl")) if not e.get("agent"))): time.sleep(1)
    print(f"[{MODEL}] on duty after {time.time() - t0:.0f} s", flush=True)
    ids = []
    for task, said in TASKS:
        tid = herd.send("donna", task, transcript=[["user", said]]); ids.append(tid); ts = time.time(); answered = False
        while time.time() - ts < 600:
            try: t = json.load(open(os.path.join(h, "herd", "donna", "status.json")))["tasks"].get(tid, {})
            except ValueError: time.sleep(0.2); continue   # mid-write
            if t.get("state") in ("done", "failed"): break
            if t.get("state") == "needs_you" and not answered: herd.send("donna", "Your call, go ahead.", reply_to=tid); answered = True
            time.sleep(1)
        print(f"[{MODEL}] {task!r}: {t.get('state')} after {time.time() - ts:.0f} s", flush=True); time.sleep(3)
    herd.send("donna", OVER)
    try: brain.wait(300)
    except subprocess.TimeoutExpired: os.killpg(brain.pid, 15); print(f"[{MODEL}] brain did not end; stopped it", flush=True)
    log.close()
    # ---- the numbers
    hev, hook = jl(os.path.join(h, "herd", "events.jsonl")), jl(os.path.join(h, "events.jsonl"))
    sess = json.load(open(meta)).get("session"); mine = [e for e in hook if e.get("session") == sess]
    spawns = [e for e in mine if e.get("ev") == "PostToolUse" and e.get("tool") == "Agent" and not e.get("agent")]
    selfw = [e for e in mine if e.get("ev") == "PostToolUse" and not e.get("agent") and e.get("tool") in ("Write", "Edit", "MultiEdit", "NotebookEdit")]
    bash = [e["input"].get("command", "") for e in mine if e.get("ev") == "PostToolUse" and not e.get("agent") and e.get("tool") == "Bash"]
    starts = [e for e in mine if e.get("ev") == "SubagentStart"]
    wts = subprocess.run(["git", "-C", r, "worktree", "list"], capture_output=True, text=True).stdout
    res = [x for x in jl(os.path.join(OUT, f"stream-{tag}.jsonl")) if x.get("type") == "result"]   # one per turn (a background task's notification starts one)
    res = {"total_cost_usd": max((x.get("total_cost_usd") or 0 for x in res), default=None), "duration_ms": sum(x.get("duration_ms") or 0 for x in res), "num_turns": sum(x.get("num_turns") or 0 for x in res)}
    rows = []
    for i, (tid, (task, _)) in enumerate(zip(ids, TASKS)):
        sent = next(e["ts"] for e in hev if e.get("ev") == "task.sent" and e.get("id") == tid)
        end = next((e["ts"] for e in hev if e.get("ev") == "task.sent" and i + 1 < len(ids) and e.get("id") == ids[i + 1]), 1e18)
        at = lambda ev, f=lambda e: True: next((round(e["ts"] - sent) for e in hev if e.get("id") == tid and e.get("ev") == ev and f(e)), None)
        sp = [e["input"] for e in spawns if sent <= e["ts"] < end]
        names = [s.get("name") for s in sp]
        rows.append({"task": task, "take": at("task.taken"), "note_named": at("task.note", lambda e: any(n and n in e.get("text", "") for n in names)),
                     "say": at("task.done"), "ask": at("task.needs_you"), "spawns": names, "unnamed": sum(not n for n in names),
                     "brief_worktree": sum("work only in" in (s.get("prompt") or "").lower() for s in sp),
                     "say_text": next((e.get("text") for e in hev if e.get("id") == tid and e.get("ev") in ("task.done", "task.failed")), None),
                     "ask_text": next((e.get("text") for e in hev if e.get("id") == tid and e.get("ev") == "task.needs_you"), None),
                     "notes": [e.get("text") for e in hev if e.get("id") == tid and e.get("ev") == "task.note"]})
    out = {"model": MODEL, "rows": rows, "self_writes": [(e["tool"], (e.get("input") or {}).get("file_path")) for e in selfw], "subagent_starts": len(starts),
           "brain_bash": bash, "worktrees": wts, "cost_usd": res.get("total_cost_usd"), "duration_s": round((res.get("duration_ms") or 0) / 1000), "turns": res.get("num_turns")}
    json.dump(out, open(os.path.join(OUT, f"brain-{tag}.json"), "w"), indent=1)
    for x in rows: print(json.dumps(x)[:600])
    print(f"[{MODEL}] self-writes {out['self_writes']}, SubagentStart {len(starts)}, cost ${out['cost_usd']}, {out['duration_s']} s\n{wts}")


main()
