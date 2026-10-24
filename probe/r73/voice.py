# /// script
# dependencies = ["websockets>=13"]
# ///
"""#73 typed probes: uv run probe/r73/voice.py CASE N OUTDIR [CHECKOUT]   (BOSON_API_KEY = key 2; CHECKOUT: the bridge to run, default this one)
Each run: a temp HIGGS_HOME, a scripted brain thread, `bridge.py --backend session --silent --text`.
through: Leo built the timer page (office.json); "Who built the timer page?", then put-through phrasing i % 10: a delegate_task in that turn, nudged or not.
hire: "Make me a quiz page."; the brain takes, notes "Hiring Mia to build the quiz page" 1 s later, says the result 25 s later:
      a VOICE line naming Mia within 10 s of the note, Mia lines before the result, GUARD lines.
pending: a request the brain takes and never finishes, four small-talk turns from the 12:53 call, then a goodbye: guard swaps,
      repeated sentences, guard-line sentences spoken, the sign-off, done claims spoken on the goodbye (#32)."""
import os, re, subprocess, sys, tempfile, threading, time
from collections import Counter
HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.abspath(sys.argv[4]) if len(sys.argv) > 4 else HERE
sys.path.insert(0, HERE); import herd, higgslive   # herd reads HIGGS_HOME per call
THROUGH = ["Okay, can you put Leo on?", "Yeah, join us. Let him join us.", "Can you bring Leo in?", "Get him on the phone.", "Let me speak with Leo.",
           "Can I talk to Leo?", "Connect me with Leo.", "Transfer me to Leo.", "Put him on.", "Can you get Leo in here?"]
PENDING = ["Let's make a web app. A Pomodoro focus timer, single page.", "Why are you doing it yourself? I thought you were supposed to delegate to someone.",
           "Next time, tell me when you hire someone. We need to work on our communication.", "Yes, sir. Thank you very much.",
           "It's been a long night at this hackathon, honestly.", "Thanks, that's all. Bye."]
norm = lambda s: " ".join(re.findall(r"[a-z0-9']+", s.lower().replace("’", "'")))
sents = lambda t: [n for p in re.split(r"(?<=[.!?;])\s+", t.strip()) if len((n := norm(p)).split()) >= 2]


def lines(log):   # (seconds, text) per bridge.log line
    for l in log.splitlines():
        if m := re.match(r"\[\s*([\d.]+)s\] (.*)", l): yield float(m[1]), m[2]


def run(case, i, out):
    with tempfile.TemporaryDirectory() as h:   # never the user's ~/.higgs: their phone and brain may be live
        env = {**os.environ, "HIGGS_HOME": h, "HIGGS_DIR": h}
        os.environ["HIGGS_HOME"] = h; herd.new("donna", project=h); stop = threading.Event()
        if case == "through":   # Leo is in the office, finished (the hooks the brain's Claude Code would fire)
            hook = lambda ev, **k: herd.hook(ev, {"session_id": "fake-brain", "cwd": h, "hook_event_name": ev, **k})
            hook("PostToolUse", tool_name="Bash", tool_input={"command": "uv run herd.py new donna"}, tool_response={})
            hook("SubagentStart", agent_id="leo1", agent_type="general-purpose")
            hook("PostToolUse", tool_name="Agent", tool_input={"name": "Leo", "description": "Builds the focus timer page", "prompt": "Build the focus timer page"},
                 tool_response={"status": "async_launched", "agentId": "leo1"})
            hook("SubagentStop", agent_id="leo1", agent_type="general-purpose")
        def work(l):
            tid, task = l["id"], l["task"].lower()
            if case == "through": herd.reply("donna", tid, "say", "Leo built the focus timer page." if "who" in task or "built" in task else "Leo is on his way to the phone.")
            elif case == "hire":
                herd.reply("donna", tid, "take", ""); time.sleep(1); herd.reply("donna", tid, "note", "Hiring Mia to build the quiz page")
                time.sleep(25); herd.reply("donna", tid, "say", "Mia built the quiz page; it's on its own branch.")
            else: herd.reply("donna", tid, "take", "")
        def brain():
            seen = set()
            while not stop.wait(0.3):
                try:
                    for l in herd.lines(herd.root() / "donna" / "inbox.jsonl"):
                        if l["id"] not in seen and not l.get("in_reply_to"): seen.add(l["id"]); threading.Thread(target=work, args=(l,), daemon=True).start()
                except (Exception, SystemExit) as e: print("  brain:", repr(e), file=sys.stderr)
        threading.Thread(target=brain, daemon=True).start()
        turns = ["Who built the timer page?", THROUGH[i % len(THROUGH)]] if case == "through" else ["Make me a quiz page for the kids site."] if case == "hire" else PENDING
        log = subprocess.run(["uv", "run", "-q", "bridge.py", "--backend", "session", "--silent", "--max-seconds", "60", "--text", " | ".join(turns)],
                             cwd=ROOT, env=env, capture_output=True, text=True, timeout=120).stdout
        stop.set(); time.sleep(0.5)
    open(os.path.join(out, f"{case}{i}.log"), "w").write(log)
    ls = list(lines(log)); voice = [(t, m[1]) for t, x in ls if (m := re.match(r"VOICE(?: \([^)]*\))?: (.*)", x))]
    if case == "through":
        at = next((k for k, (_, x) in enumerate(ls) if x.startswith("USER (typed): " + turns[1])), len(ls))
        nxt = ls[at:]; d = next((k for k, (_, x) in enumerate(nxt) if x.startswith("DELEGATION")), None)
        r = dict(delegated=d is not None, nudged=d is not None and any("GUARD" in x for _, x in nxt[:d]),
                 task=nxt[d][1].split(": ", 1)[-1] if d is not None else "", said=" | ".join(v for t, v in voice if t >= (nxt[0][0] if nxt else 0))[:200])
        print(f"{case}{i}: {turns[1]!r} -> {r}", flush=True)
    elif case == "hire":
        t0 = next((t for t, x in ls if "~ note: Hiring Mia" in x), None); t1 = next((t for t, x in ls if re.match(r"→ (commentary|attached held result) (?!\(no delegation)", x)), 1e9)   # the result, not the note
        mia = [(t, v) for t, v in voice if t0 is not None and t0 <= t < t1 and "mia" in v.lower()]
        r = dict(noted=t0 is not None, spoken_in=round(mia[0][0] - t0, 1) if mia else None, mia_lines=len(mia), guard=log.count("GUARD"), said=[v for _, v in mia])
        print(f"{case}{i}: {r}", flush=True)
    else:
        vs = [v for _, v in voice]; c = Counter(s for v in vs for s in sents(v)); dup = {s: k for s, k in c.items() if k > 1}
        bye = next((t for t, x in ls if x.startswith("USER (typed): " + PENDING[-1])), 1e9)
        claims = [p for t, v in voice if t >= bye for p in re.split(r"(?<=[.!?;\]}])\s+", v) if higgslive.fabricated(p)]
        r = dict(swaps=log.count("fabricated:"), dup=sum(k - 1 for k in dup.values()), guard_lines=sum(c[s] for s in higgslive.GUARD_SENTS if s in c),
                 repeat=log.count("repeat:"), signoff="sign-off heard" in log, claims=len(claims), GUARD=log.count("GUARD"))
        print(f"{case}{i}: {r} dups={list(dup)}", flush=True)
        for _, v in voice: print(f"    VOICE: {v[:160]}", flush=True)
    return r


if __name__ == "__main__":
    case, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]; os.makedirs(out, exist_ok=True)
    rs = [run(case, i, out) for i in range(n)]   # one at a time: parallel bridges on one key fail with upstream_error (#32)
    tot = lambda k: sum(int(bool(r[k])) for r in rs)
    if case == "through": print(f"== through ({ROOT}): delegated {tot('delegated')}/{n} ({tot('delegated') - tot('nudged')} without GUARD's nudge)")
    elif case == "hire": print(f"== hire ({ROOT}): Mia spoken within 10 s {sum(r['spoken_in'] is not None and r['spoken_in'] <= 10 for r in rs)}/{n}, "
                               f"Mia lines before the result {sum(r['mia_lines'] for r in rs)}, GUARD {sum(r['guard'] for r in rs)}")
    else: print(f"== pending ({ROOT}): swaps {sum(r['swaps'] for r in rs)}, repeated sentences {sum(r['dup'] for r in rs)}, guard-line sentences spoken {sum(r['guard_lines'] for r in rs)}, "
                f"repeat lines {sum(r['repeat'] for r in rs)}, signed off {tot('signoff')}/{n}, done claims on the goodbye {sum(r['claims'] for r in rs)}, GUARD {sum(r['GUARD'] for r in rs)}")
