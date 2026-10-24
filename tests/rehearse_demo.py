"""Rehearse docs/demo.md's beats headlessly on the real path (#12): a fresh scratch git repo (README only), its own
HIGGS_HOME, the brain as the demo runs it (`claude --settings hooks/office.json --model sonnet` in the repo, told to follow
this checkout's /call skill; here inside a tmux session of its own only so it can be driven, and never woken by typing),
`bridge.py --ring --silent --backend session` (no --brain), the presenter's lines typed on the bridge's stdin, office.json
sampled every second. Stdlib only. Uses BOSON_API_KEY as exported: give it key 2, never the live phone's.

    uv run tests/rehearse_demo.py OUTDIR    # OUTDIR/{run.log, bridge.out, office.jsonl, brain.txt, inbox/outbox.jsonl}
"""
import json, os, re, shutil, signal, subprocess, sys, tempfile, threading, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]).resolve(); OUT.mkdir(parents=True, exist_ok=True)
HOME = Path(tempfile.mkdtemp(prefix="dh", dir=OUT)); PROJ = OUT / "focus"
TMUX = "rehearse-" + HOME.name   # not herd.tmux_name(): nothing types tasks into it, as with the demo's plain terminal
LINES: list = []   # (wall, bridge stdout line)
T0 = time.time()
RUNLOG = open(OUT / "run.log", "w")


def say(*a):
    s = f"[{time.time() - T0:6.1f}] " + " ".join(map(str, a)); print(s, flush=True); RUNLOG.write(s + "\n"); RUNLOG.flush()


def tail(path):   # every bridge line with the wall time we saw it (polled every 0.1 s)
    pos = 0
    while True:
        try:
            with open(path, "rb") as f: f.seek(pos); data = f.read()
        except OSError: data = b""
        if b"\n" in data:
            data = data[:data.rindex(b"\n") + 1]; pos += len(data)
            now = time.time(); LINES.extend((now, l) for l in data.decode(errors="replace").splitlines())
        time.sleep(0.1)


def wait(pat, timeout, since):   # first bridge line matching `pat` seen after wall time `since`
    end = time.time() + timeout
    while time.time() < end:
        for w, l in list(LINES):
            if w >= since and re.search(pat, l): return w, l
        time.sleep(0.2)
    say(f"TIMEOUT {timeout}s waiting for {pat!r}"); return None, None


def office():
    try: return json.loads((HOME / "office.json").read_text())
    except Exception: return {"workers": [], "assignments": []}


def names(): return [w["name"] for w in office()["workers"][1:] if w.get("name")]


def sampler():
    last = None
    with open(OUT / "office.jsonl", "w") as f:
        while True:
            o = office()
            snap = [(w.get("name"), w.get("status"), (w.get("currentAction") or "")[:40]) for w in o["workers"]] + \
                   [("A:" + (a.get("title") or "")[:30], a.get("status"), "") for a in o["assignments"]] + [("call", (o.get("call") or {}).get("state"), "")]
            if snap != last: f.write(json.dumps({"t": round(time.time() - T0, 1), "rows": snap}) + "\n"); f.flush(); last = snap
            time.sleep(1)


def tm(*a): return subprocess.run(["tmux", "-L", "rehearse", *a], capture_output=True, text=True)   # its own tmux server: a kill-server on the default one (twice on Oct 24) leaves it alone


def brain(env):   # the demo's brain: Claude Code in the repo; a new folder asks for trust first (pick the "Yes" line)
    tm("new-session", "-d", "-s", TMUX, "-x", "200", "-y", "50", "-c", str(PROJ), "-e", f"HIGGS_HOME={HOME}",
       "env", "-u", "ANTHROPIC_API_KEY", "claude", "--settings", str(REPO / "hooks/office.json"), "--model", "sonnet")
    for _ in range(90):
        pane = tm("capture-pane", "-p", "-t", f"={TMUX}:").stdout
        if "trust" in pane.lower():
            cur = next((l for l in pane.splitlines() if "❯" in l), "")
            say("trust dialog, cursor on:", cur.strip()); tm("send-keys", "-t", f"={TMUX}:", "Enter" if "yes" in cur.lower() else "Down")
        elif "❯" in pane: break
        time.sleep(1.5)
    tm("send-keys", "-t", f"={TMUX}:", "-l", f"Read {REPO}/.claude/skills/call/SKILL.md and follow it: you are Donna's brain."); time.sleep(0.5)
    tm("send-keys", "-t", f"={TMUX}:", "Enter"); say("brain told to follow /call")


BEATS: list = []   # (name, wall) when the line was typed


def type_(beat, text):
    BEATS.append((beat, time.time())); say(f"== {beat}: typed {text!r}"); BRIDGE.stdin.write(text + "\n"); BRIDGE.stdin.flush()


def flow():
    t = wait(r"ring: waiting", 60, T0)[0]
    if not t: return
    end = time.time() + 120   # the brain registers (the hook writes meta.json's session) and starts its wait loop
    while time.time() < end and not json.loads((HOME / "herd/donna/meta.json").read_text() if (HOME / "herd/donna/meta.json").exists() else "{}").get("session"): time.sleep(1)
    say("brain registered" if time.time() < end else "brain NOT registered in 120 s"); time.sleep(15)
    type_("1 pickup", ""); t = BEATS[-1][1]
    wait(r"VOICE", 20, t); time.sleep(2)
    type_("2 thin request", "Let's build a small focus timer web app."); t = BEATS[-1][1]
    did = (re.search(r"DELEGATION (\S+)", wait(r"DELEGATION", 30, t)[1] or "") or [None, "?"])[1]
    wait(r"→ ask", 120, t); wait(r"VOICE", 20, wait(r"→ ask", 1, t)[0] or t); time.sleep(3)
    type_("3 yes + counter", "Yes, and give it a session counter."); t = BEATS[-1][1]
    wait(r"~ note: Hir", 90, t); time.sleep(12)
    type_("4 status", "How's it going?"); t = BEATS[-1][1]
    wait(r"VOICE", 30, t); time.sleep(1)
    type_("4b follow-up", "Actually, sorry, one thing: make the break five minutes."); t = BEATS[-1][1]
    d2 = wait(r"DELEGATION", 30, t)[1] or ""; wait(r"VOICE", 30, t)   # demo-script.md says it as a barge-in; typed, it lands after her status line
    if "(replaces" in d2: did = re.search(r"DELEGATION (\S+)", d2)[1]   # the old task's result is dropped: the brain answers on the new id
    t = wait(rf"→ (commentary|attached held result) {re.escape(did)}", 600, t)[0] or time.time(); wait(r"VOICE", 30, t); time.sleep(3)
    type_("6a who built", "Who built the timer?"); t = BEATS[-1][1]
    end = time.time() + 60; who = None
    while time.time() < end and not who:
        voice = " ".join(l for w, l in LINES if w >= t and "VOICE" in l)
        who = next((n for n in names() if n in voice), None); time.sleep(0.5)
    who = who or (names() or ["Ava"])[0]; say("name heard/used:", who); time.sleep(3)
    type_("6b put through", f"Put me through to {who}."); t = BEATS[-1][1]
    t2 = wait(r"session ready .*voice: (?!nora)", 60, t)[0]
    if t2: wait(r"VOICE", 20, t2)
    time.sleep(3)
    type_("6c ask worker", "Why did you pick that interval length?"); t = BEATS[-1][1]
    t2 = wait(r"→ (commentary|attached held result)", 150, t)[0]; wait(r"VOICE", 25, t2 or t); time.sleep(3)
    type_("6d back", "Put Donna back on."); t = BEATS[-1][1]
    t2 = wait(r"session ready .*voice: nora", 60, t)[0]
    if t2: wait(r"VOICE", 20, t2)
    time.sleep(3)
    type_("7 PR + bye", "Open a pull request. Thanks, that's all, bye."); t = BEATS[-1][1]
    t2 = wait(r"call\.ended", 60, t)[0]
    t3 = wait(r"call\.ring", 300, t2 or t)[0]
    if t3:
        wait(r"VOICE", 30, t3); time.sleep(3); type_("7b ring bye", "Thanks, bye."); wait(r"call\.ended", 40, BEATS[-1][1])


KEEP = re.compile(r"VOICE|USER|DELEGATION|→ ask|~ note|→ commentary|attached held|task_status|GUARD|repeat|fabricated|transfer|session ready|call\.|voice\.speaking|sign-off|back phrase|answer →|no take|holding|dropped|ERROR|failed|idle|nudg")


def report():
    say("\n===== beats (seconds from the typed line) =====")
    for i, (beat, t) in enumerate(BEATS):
        nxt = BEATS[i + 1][1] if i + 1 < len(BEATS) else time.time()
        sp = next((w for w, l in LINES if t <= w < nxt and "voice.speaking" in l), None)
        say(f"-- {beat}: first audio {f'{sp - t:.1f}s' if sp else 'none'}")
        for w, l in LINES:
            if t <= w < nxt and KEEP.search(l): say(f"   +{w - t:5.1f} {l[l.find(']') + 2:][:300]}")


try:
    env = {**os.environ, "HIGGS_HOME": str(HOME)}; env.pop("HIGGS_DIR", None)
    PROJ.mkdir(); (PROJ / "README.md").write_text("# focus\n")
    subprocess.run("git init -q -b main && git add README.md && git commit -qm init", shell=True, cwd=PROJ, check=True)
    say(f"HIGGS_HOME={HOME} repo={PROJ} tmux={TMUX}")
    brain(env)
    BRIDGE = subprocess.Popen(["uv", "run", "-q", "bridge.py", "--ring", "--silent", "--backend", "session", "--voice", "nora"],
                              cwd=REPO, env=env, stdin=subprocess.PIPE, text=True, stdout=open(OUT / "bridge.out", "w"), stderr=subprocess.STDOUT, start_new_session=True)
    for f in (lambda: tail(OUT / "bridge.out"), sampler): threading.Thread(target=f, daemon=True).start()
    flow()
finally:
    time.sleep(2); report()
    (OUT / "brain.txt").write_text(tm("capture-pane", "-p", "-J", "-S", "-3000", "-t", f"={TMUX}:").stdout)
    for f in ("inbox.jsonl", "outbox.jsonl"):
        if (HOME / "herd/donna" / f).exists(): shutil.copy(HOME / "herd/donna" / f, OUT / f)
    try: os.killpg(BRIDGE.pid, signal.SIGTERM); BRIDGE.wait(10)
    except Exception: pass
    tm("kill-session", "-t", f"={TMUX}")
    say("cleaned up: bridge and tmux", TMUX)
