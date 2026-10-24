# /// script
# dependencies = []
# ///
"""#36: does the voice keep answering while a task is pending? uv run probe/r36/pending.py N OUTDIR   (BOSON_API_KEY = key 2)
Each run: a temp HIGGS_HOME with Donna on duty and no brain (the first task stays queued), then `bridge.py --backend session
--silent --text` with a request and four more turns: a new request, a question about the work, "how's it going", small talk.
Counts per run: delegations (the 2nd must not be a `replaces`), identical VOICE sentences, the status reply's words."""
import os, re, subprocess, sys, tempfile
from collections import Counter
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TURNS = ["Okay, I want you to create a simple website for this hackathon project, whatever we built on.",   # the Oct 24 08:33 call, cleaned up
         "And compile a plan for a marketing team. Yeah, go ahead, do it.", "How many people are working on it? If you need more agents you bring more, am I right, Donna?",
         "How's it going?", "Okay, cool. It's been a long night at this hackathon, honestly."]
norm = lambda s: " ".join(re.findall(r"[a-z0-9']+", s.lower().replace("’", "'")))
sents = lambda t: [n for p in re.split(r"(?<=[.!?;])\s+", t.strip()) if len((n := norm(p)).split()) >= 2]   # "Sure." alone is no repeat


def run(i, out):
    with tempfile.TemporaryDirectory() as h:   # never the user's ~/.higgs: their phone and brain may be live
        env = {**os.environ, "HIGGS_HOME": h, "HIGGS_DIR": h}
        subprocess.run(["uv", "run", "-q", "herd.py", "new", "donna", "--project", h], cwd=ROOT, env=env, capture_output=True)
        log = subprocess.run(["uv", "run", "-q", "bridge.py", "--backend", "session", "--silent", "--max-seconds", "45", "--text", " | ".join(TURNS)],
                             cwd=ROOT, env=env, capture_output=True, text=True, timeout=90).stdout
    open(os.path.join(out, f"run{i}.log"), "w").write(log)
    voice, turn, by_turn = [], None, {}
    for line in log.splitlines():
        if m := re.search(r"USER \(typed\): (.*)", line): turn = m.group(1)
        elif m := re.search(r"VOICE(?: \([^)]*\))?: (.*)", line): voice.append(m.group(1)); by_turn.setdefault(turn, []).append(m.group(1))
        elif "DELEGATION" in line or "task_status →" in line: by_turn.setdefault(turn, []).append("<" + line.split("] ", 1)[1][:60] + ">")
    dels = [l for l in log.splitlines() if "DELEGATION" in l]
    c = Counter(s for v in voice for s in sents(v))
    dup = {s: k for s, k in c.items() if k > 1}
    status = " ".join(v for v in by_turn.get(TURNS[3], []) if not v.startswith("<"))
    before = {s for t in TURNS[:3] for v in by_turn.get(t, []) for s in sents(v)}
    r = dict(dels=len(dels), second=len(dels) > 1 and "(replaces" not in dels[1], dup=sum(k - 1 for k in dup.values()),
             status_new=bool(status) and not set(sents(status)) & before, status_words=len(status.split()),
             repeat=log.count("repeat:"), guard=log.count("GUARD"), errors=log.count("ERROR"))
    print(f"run{i}: {r} dups={list(dup)}", flush=True)
    for t in TURNS[1:]: print(f"    {t[:30]!r:34} -> {' | '.join(by_turn.get(t, []))[:200]}", flush=True)
    return r


if __name__ == "__main__":
    n, out = int(sys.argv[1]), sys.argv[2]; os.makedirs(out, exist_ok=True)
    rs = [run(i, out) for i in range(n)]   # one at a time: parallel bridges on one key fail with upstream_error (#32)
    tot = lambda k: sum(int(r[k]) for r in rs)
    print(f"{n} runs: second delegation {tot('second')}/{n}, identical sentences {tot('dup')}, status in new words {tot('status_new')}/{n} "
          f"(mean {tot('status_words') / n:.1f} words), repeat {tot('repeat')}, GUARD {tot('guard')}, errors {tot('errors')}")
