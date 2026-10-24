# /// script
# dependencies = []
# ///
"""#56: is a result told twice? uv run probe/r56/repeat.py N OUTDIR [CHECKOUT]   (BOSON_API_KEY = key 2; CHECKOUT: the bridge to run, default this one)
The Oct 24 10:38 call, typed: an earlier result nobody heard says the page is open in the browser (so the voice may claim it early),
the user asks to open the website, the brain takes it and 6 s later says "It's open in your browser now."; two more turns.
Per run: identical VOICE sentences (2+ words), whether the result was delivered, `repeat:` lines."""
import os, re, subprocess, sys, tempfile, threading, time
from collections import Counter
HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else HERE
sys.path.insert(0, HERE); import herd   # reads HIGGS_HOME per call
TURNS = ["Uh, can you just open the website on my browser first? I just wanna have a quick look at it.", "Is it open yet?", "Okay, I'm looking at it now. Thanks."]
RESULT = "It's open in your browser now."
norm = lambda s: " ".join(re.findall(r"[a-z0-9']+", s.lower().replace("’", "'")))
sents = lambda t: [n for p in re.split(r"(?<=[.!?;])\s+", t.strip()) if len((n := norm(p)).split()) >= 2]


def run(i, out):
    with tempfile.TemporaryDirectory() as h:   # never the user's ~/.higgs: their phone and brain may be live
        env = {**os.environ, "HIGGS_HOME": h, "HIGGS_DIR": h}
        os.environ["HIGGS_HOME"] = h; herd.new("donna", project=h); stop = threading.Event()
        old = herd.send("donna", "Create a simple HTML page explaining the project."); herd.reply("donna", old, "take", "")
        herd.reply("donna", old, "say", "The page I just made explains our project. I've opened it in your browser.")   # untold: task_status lists it (10:38)
        def brain():   # take each new task, say the result 6 s later
            seen = {old}
            while not stop.wait(0.3):
                try:
                    for l in herd.lines(herd.root() / "donna" / "inbox.jsonl"):
                        if l["id"] not in seen and not l.get("in_reply_to"):
                            seen.add(l["id"]); herd.reply("donna", l["id"], "take", "")
                            threading.Timer(6, lambda t=l["id"]: herd.reply("donna", t, "say", RESULT)).start()
                except (Exception, SystemExit) as e: print("  brain:", repr(e), file=sys.stderr)
        threading.Thread(target=brain, daemon=True).start()
        log = subprocess.run(["uv", "run", "-q", "bridge.py", "--backend", "session", "--silent", "--max-seconds", "45", "--text", " | ".join(TURNS)],
                             cwd=ROOT, env=env, capture_output=True, text=True, timeout=90).stdout
        stop.set(); time.sleep(0.5)
    open(os.path.join(out, f"run{i}.log"), "w").write(log)
    voice = [m.group(1) for l in log.splitlines() if (m := re.search(r"VOICE(?: \([^)]*\))?: (.*)", l))]
    c = Counter(s for v in voice for s in sents(v)); dup = {s: k for s, k in c.items() if k > 1}
    r = dict(dup=sum(k - 1 for k in dup.values()), told=("→ commentary" in log or "→ attached" in log), repeat=log.count("repeat:"), retried=log.count("dropped, retrying"))
    print(f"run{i}: {r} dups={list(dup)}", flush=True)
    for v in voice: print(f"    VOICE: {v[:160]}", flush=True)
    return r


if __name__ == "__main__":
    n, out = int(sys.argv[1]), sys.argv[2]; os.makedirs(out, exist_ok=True)
    rs = [run(i, out) for i in range(n)]   # one at a time: parallel bridges on one key fail with upstream_error (#32)
    tot = lambda k: sum(int(r[k]) for r in rs)
    print(f"{n} runs ({ROOT}): runs with a repeated sentence {sum(r['dup'] > 0 for r in rs)}/{n}, identical sentences {tot('dup')}, result delivered {tot('told')}/{n}, "
          f"repeat lines {tot('repeat')}, retried {tot('retried')}")
