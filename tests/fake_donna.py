# /// script
# dependencies = []
# ///
"""A scripted fake Donna for a headless end-to-end check of the task lifecycle. Stdlib only.

    uv run tests/fake_donna.py          # the agent: watches the herd inbox, take -> note -> (ask ->) say
    uv run tests/fake_donna.py --demo   # driver: temp HIGGS_HOME, agent thread + `bridge.py --ring --silent`, scripted turns
"""
import json, os, queue, subprocess, sys, tempfile, threading, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))   # import herd from the repo root
answers: dict = {}


def out(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def say(herd, tid, kind, text):
    try:
        herd.reply("donna", tid, kind, text)
        out(f"reply {tid} {kind} {text}")
    except SystemExit as e:  # herd refuses illegal transitions
        out(f"refused: {e}")


def work(herd, line):
    tid, task = line["id"], line["task"]
    say(herd, tid, "take", ""); time.sleep(0.5)
    say(herd, tid, "note", "looking at the folder")
    if "quick" in task.lower():
        time.sleep(1.0); say(herd, tid, "say", "Twelve files, all small."); return
    say(herd, tid, "ask", "Should the page be blue or green?")
    try:
        answer = answers.setdefault(tid, queue.Queue()).get(timeout=60)
    except queue.Empty:
        say(herd, tid, "fail", "No answer came, so I stopped."); return
    time.sleep(1.0)
    say(herd, tid, "say", f"Done. The page is written in {answer.strip().rstrip('.')} and open in your browser.")


def agent():
    import herd
    herd.new("donna", project=os.getcwd())
    inbox = herd.root() / "donna" / "inbox.jsonl"
    inbox.touch()
    pos, buf = inbox.stat().st_size, b""
    while True:
        with open(inbox, "rb") as f:
            f.seek(pos); data = f.read()
        pos += len(data); buf += data
        *done, buf = buf.split(b"\n")  # complete lines only
        for raw in filter(None, done):
            line = json.loads(raw)
            if r := line.get("in_reply_to"):
                answers.setdefault(r, queue.Queue()).put(line["task"])
            else:
                threading.Thread(target=work, args=(herd, line), daemon=True).start()
        time.sleep(0.2)


def demo():
    tmp = tempfile.mkdtemp()
    os.environ["HIGGS_HOME"] = os.environ["HIGGS_DIR"] = tmp
    threading.Thread(target=agent, daemon=True).start()
    import herd
    logf = REPO / "bridge.log"
    start = logf.stat().st_size if logf.exists() else 0
    bridge = subprocess.Popen(["uv", "run", "-q", "bridge.py", "--ring", "--silent", "--backend", "session", "--max-seconds", "90"],
                              cwd=REPO, stdin=subprocess.PIPE, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy())
    pos = start

    def tail():
        return logf.read_bytes()[start:].decode(errors="replace") if logf.exists() else ""

    def wait_log(sub, timeout):  # first line containing sub from the last match on
        nonlocal pos
        end = time.time() + timeout
        while time.time() < end:
            data = logf.read_bytes()[pos:].decode(errors="replace") if logf.exists() else ""
            for l in data.splitlines(keepends=True):
                pos += len(l.encode())
                if sub in l and l.endswith("\n"):
                    return l
            time.sleep(0.2)
        raise TimeoutError(f"no {sub!r} in {timeout}s")

    def type_(text):
        bridge.stdin.write(text + "\n"); bridge.stdin.flush()

    ok = False
    try:
        wait_log("ring: waiting", 30)
        herd.send("donna", "make a page for the launch")
        wait_log("→ ask", 40)  # the question reached the voice
        wait_log("VOICE", 20)  # the voice asked it
        herd.send("donna", "quick count of the files")
        wait_log("holding", 20)  # the second result waits while the question is open
        time.sleep(2)
        type_("Blue, please.")
        wait_log("answer → donna", 15)
        wait_log("→ commentary", 40)  # the final say, spoken after the lull
        time.sleep(3)
        type_("Thanks, bye")
        wait_log("call.ended", 30)
        ok = True
    except Exception as e:
        print(f"FAILED: {e}")
    finally:
        bridge.terminate()
        try: bridge.wait(10)
        except subprocess.TimeoutExpired: subprocess.run(["pkill", "-f", "bridge.py --ring"])
        print(tail())
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else agent()
