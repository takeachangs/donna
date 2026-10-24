# /// script
# dependencies = []
# ///
"""Live check (paid session!): `bridge.py --ring` waits idle, rings on a Donna `say`, hangs up after ~60 s of silence.

  uv run test_ring.py
"""
import json, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))

def events(path):
    try: return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError: return []

if __name__ == "__main__":
    if not os.environ.get("BOSON_API_KEY"): sys.exit("set BOSON_API_KEY (this opens a paid live session)")
    tmp = tempfile.mkdtemp()
    ev_path = os.path.join(tmp, "herd", "events.jsonl")
    outbox = os.path.join(tmp, "herd", "donna", "outbox.jsonl")
    p = subprocess.Popen(["uv", "run", "-q", "bridge.py", "--ring", "--silent", "--backend", "session"], cwd=HERE,
                         env={**os.environ, "HIGGS_DIR": tmp}, stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out, took = "", None
    try:
        time.sleep(4)
        assert not any(e["ev"] == "call.ring" for e in events(ev_path)), "rang before any say"
        os.makedirs(os.path.dirname(outbox), exist_ok=True)
        t0 = time.time()
        with open(outbox, "a") as f: f.write(json.dumps({"id": "x", "kind": "say", "text": "the review is done", "ts": t0}) + "\n")
        while time.time() - t0 < 100 and not any(e["ev"] == "call.ended" for e in events(ev_path)): time.sleep(1)
        took = time.time() - t0
    finally:
        p.terminate()
        try: out = p.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired: p.kill(); out = p.communicate()[0]
    evs = events(ev_path)
    names = [e["ev"] for e in evs]
    print("events:", names, f"| say -> ended: {took:.0f}s")
    assert all(n in names for n in ("call.ring", "call.answered", "call.ended")), f"missing events: {names}"
    assert names.index("call.ring") < names.index("call.answered") < names.index("call.ended"), f"bad order: {names}"
    assert "review is done" in next(e for e in evs if e["ev"] == "call.ring").get("about", ""), "ring.about lacks the say text"
    assert "session ready" in out, "no 'session ready'"   # bridge prints every log line; bridge.log holds older runs too
    voice = [l for l in out.splitlines() if "VOICE" in l]
    assert voice, "no VOICE line"
    print("\n".join(voice[-3:])); print("ok")
