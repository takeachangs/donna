# /// script
# dependencies = []
# ///
"""A scripted stand-in for Donna's brain (the /call session) for a headless check of the task lifecycle. Stdlib only.

    uv run tests/fake_donna.py          # the agent: watches the herd inbox, take -> note -> (ask ->) say
    uv run tests/fake_donna.py --demo   # driver: temp HIGGS_HOME, agent thread + `bridge.py --ring --silent`, scripted turns;
                                        # ends with a task still running at the goodbye, whose later say rings a second call
    uv run tests/fake_donna.py --transfer   # #28: who built it -> put through to Maya (her voice) -> a question only her
                                        # transcript answers -> back to Donna (her voice) -> bye
"""
import json, os, queue, signal, subprocess, sys, tempfile, threading, time
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


MAYA = "I gave every question a thirty second timer, and the last one is a bonus round."  # in Maya's transcript only (#28)


def work(herd, line):
    tid, task = line["id"], line["task"]
    said = (task + " " + " ".join(t for _, t in line.get("transcript") or [])).lower()
    if line.get("with") == "Maya":  # put through: the brain forwards to Maya (SendMessage) and says her answer
        say(herd, tid, "take", ""); time.sleep(1.0); say(herd, tid, "say", MAYA if "timer" in said or "question" in said else "That's not mine; Donna will know."); return
    if "maya" in said and any(w in task.lower() for w in ("line", "through", "talk", "connect", "speak", "transfer")):  # before who-built: "connect me with Maya, who built it"
        say(herd, tid, "transfer", "Maya"); return
    if any(w in task.lower() for w in ("who", "author", "creator")):  # "who built the quiz?", "identify the author of the quiz"
        say(herd, tid, "say", "Maya built the quiz."); return
    say(herd, tid, "take", ""); time.sleep(0.5)
    say(herd, tid, "note", "looking at the folder")
    if "quick" in task.lower():
        time.sleep(1.0); say(herd, tid, "say", "Twelve files, all small."); return
    if "backup" in task.lower():  # still running when the user hangs up: this say must ring them (#32)
        time.sleep(25); say(herd, tid, "say", "The backup of the notes folder is done."); return
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
    hook = lambda ev, **k: herd.hook(ev, {"session_id": "fake-brain", "cwd": os.getcwd(), "hook_event_name": ev, **k})  # the office's workers come from hooks
    hook("PostToolUse", tool_name="Bash", tool_input={"command": "uv run herd.py new donna"}, tool_response={})  # registers this "session" as the brain
    for aid, name, role in (("ben1", "Ben", "Writes the server"), ("maya1", "Maya", "Builds the quiz")):  # Ben: a male look, Maya: the first female look (chloe)
        hook("SubagentStart", agent_id=aid, agent_type="general-purpose")
        hook("PostToolUse", tool_name="Agent", tool_input={"name": name, "description": role, "prompt": role}, tool_response={"status": "async_launched", "agentId": aid})
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


def ask_flow(herd, wait_log, type_):  # ask -> answer -> two results -> a task still running at the goodbye rings a second call
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
    type_("Also make a backup of the notes folder.")
    wait_log("DELEGATION", 20)  # sent from the call: the bridge claims its id
    time.sleep(3)  # the ack: logged before or after the DELEGATION line, depending on the response
    type_("Thanks, bye")  # the backup is still running: no "done" claim, the sign-off still closes
    wait_log("call.ended", 30)
    wait_log("call.ring", 40)  # the brain's later say for the call's own task rings
    wait_log("VOICE", 30)
    type_("Great, thanks. Bye.")
    wait_log("call.ended", 30)


def transfer_flow(herd, wait_log, type_):  # #28: each segment is a fresh session; session.created's voice proves who is talking
    wait_log("ring: waiting", 30)
    type_("")  # Enter: call Donna
    assert "voice: nora" in wait_log("session ready", 30)
    time.sleep(1)
    type_("Who built the quiz?")
    wait_log("→ commentary", 40); assert "Maya" in wait_log("VOICE", 20)
    time.sleep(2)
    type_("Get me on the line with her.")
    wait_log("transfer: putting the user through to Maya", 40)
    wait_log("event call.transfer", 30)
    assert "voice: chloe" in wait_log("session ready", 30)  # Maya's voice: office.json workers[].voice (the first female look)
    assert herd.office()["call"].get("with") == "maya1", herd.office()["call"]  # the office walks her to the phone
    assert "Maya" in wait_log("VOICE", 20)  # "Hey, it's Maya."
    time.sleep(2)
    type_("How long is the timer on each question?")
    wait_log("DELEGATION", 20)
    assert herd.lines(herd.root() / "donna" / "inbox.jsonl")[-1].get("with") == "Maya"  # the brain forwards it to her
    wait_log("→ commentary", 40); v = wait_log("VOICE", 20).lower(); assert "thirty" in v or "30" in v, v  # her own transcript's answer
    time.sleep(2)
    type_("Great, thanks. Put Donna back on.")
    wait_log("back phrase heard", 40)
    assert "voice: nora" in wait_log("session ready", 30)
    assert herd.office()["call"].get("with") == "donna", herd.office()["call"]
    assert "Donna" in wait_log("VOICE", 20)  # "Hey, it's Donna again."
    time.sleep(2)
    type_("Thanks, bye")
    wait_log("call.ended", 30)


def demo(flow):
    tmp = tempfile.mkdtemp()
    os.environ["HIGGS_HOME"] = os.environ["HIGGS_DIR"] = tmp
    threading.Thread(target=agent, daemon=True).start()
    import herd
    logf = REPO / "bridge.log"
    start = logf.stat().st_size if logf.exists() else 0
    bridge = subprocess.Popen(["uv", "run", "-q", "bridge.py", "--ring", "--silent", "--backend", "session", "--voice", "nora", "--max-seconds", "90"],
                              cwd=REPO, stdin=subprocess.PIPE, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy(),
                              start_new_session=True)  # its own process group: the teardown kills this bridge (uv and its python), never a real phone
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
        flow(herd, wait_log, type_)
        ok = True
    except Exception as e:
        print(f"FAILED: {e!r}")
    finally:
        os.killpg(bridge.pid, signal.SIGTERM)
        try: bridge.wait(10)
        except subprocess.TimeoutExpired: os.killpg(bridge.pid, signal.SIGKILL)
        print(tail())
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    demo(ask_flow) if "--demo" in sys.argv else demo(transfer_flow) if "--transfer" in sys.argv else agent()
