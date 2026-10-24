# /// script
# dependencies = ["websockets>=13"]
# ///
"""A scripted stand-in for Donna's brain (the /call session) for a headless check of the task lifecycle. Stdlib only.

    uv run tests/fake_donna.py          # the agent: watches the herd inbox, take -> note -> (ask ->) say
    uv run tests/fake_donna.py --demo   # driver: temp HIGGS_HOME, agent thread + `bridge.py --ring --silent`, scripted turns;
                                        # ends with a task still running at the goodbye, whose later say rings a second call
    uv run tests/fake_donna.py --transfer   # #28: who built it -> put through to Maya (her voice) -> a question only her
                                        # transcript answers -> back to Donna (her voice) -> bye; the put-through is "can you put Maya on?" (#73)
    uv run tests/fake_donna.py --fast-take  # #49: the brain takes each task within ~10 ms, then stays silent past the 20 s
                                        # deaf-brain timer: every take must reach the bridge (no "no take for" line)
    uv run tests/fake_donna.py --order  # #55: three tasks, each result a bare "Done.", landing in another order: each reply
                                        # names its own task, no claim names one whose result has not gone in
    uv run tests/fake_donna.py --bye-race [--control]  # #55: the music backup's "Done." lands 0.5 s before "Thanks, bye" while
                                        # the notes backup runs: it is spoken; --control: no result, no done claim spoken
"""
import json, os, queue, re, signal, subprocess, sys, tempfile, threading, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))   # import herd, higgslive from the repo root
answers: dict = {}
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else 'claude'
if ENGINE not in ('claude', 'codex'): raise SystemExit('--engine must be claude or codex')
QUIET = threading.Event()  # --fast-take: take at once, then nothing for 25 s (a missed take would look like a deaf brain)
ORDER, TAKEN = threading.Event(), threading.Barrier(3)  # --order: all three taken, then "Done." for notes, photos, music (#55)
RACE, GO = threading.Event(), threading.Event()  # --bye-race: the music backup's "Done." when the driver sets GO; the notes backup never ends


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
    if QUIET.is_set():
        say(herd, tid, "take", ""); time.sleep(25); say(herd, tid, "say", "Done."); return
    if ORDER.is_set():  # sent photos, music, notes; told notes (1 s), photos (9 s), music (17 s) after the third take
        say(herd, tid, "take", "")
        try: TAKEN.wait(60)
        except threading.BrokenBarrierError: pass
        time.sleep(next((d for w, d in (("note", 1), ("photo", 9), ("music", 17)) if w in task.lower()), 25)); say(herd, tid, "say", "Done."); return
    if RACE.is_set():
        say(herd, tid, "take", "")
        if "music" in task.lower(): GO.wait(); say(herd, tid, "say", "Done.")
        return
    said = (task + " " + " ".join(t for _, t in line.get("transcript") or [])).lower()
    if line.get("with") == "Maya":  # put through: the brain forwards to Maya (SendMessage) and says her answer
        if ENGINE == 'codex':
            say(herd, tid, 'take', '')
            request = herd.send('Maya', 'On the phone with the person: ' + task)
            until = time.monotonic() + 90
            while time.monotonic() < until:
                result = next((m for m in herd.lines(herd.root()/'Maya/outbox.jsonl') if m['id']==request and m['kind'] in ('say','fail')), None)
                if result: say(herd, tid, result['kind'], result['text']); return
                time.sleep(.2)
            say(herd, tid, 'fail', 'Maya did not answer in time.'); return
        say(herd, tid, "take", ""); time.sleep(1.0)
        if "why" in task.lower(): say(herd, tid, "say", "I picked thirty seconds so nobody waits long on one question."); return  # #82
        say(herd, tid, "say", MAYA if "timer" in said or "question" in said else "That's not mine; Donna will know."); return
    if "maya" in said and any(w in task.lower() for w in ("line", "through", "talk", "connect", "speak", "transfer", "put", "join", "bring", "phone")):  # before who-built: "connect me with Maya, who built it"
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
    herd.new("donna", kind='codex' if ENGINE == 'codex' else 'session', project=os.getcwd())
    hook = lambda ev, **k: herd.hook(ev, {"session_id": "fake-brain", "cwd": os.getcwd(), "hook_event_name": ev, **k})  # the office's workers come from hooks
    if ENGINE == 'claude': hook("PostToolUse", tool_name="Bash", tool_input={"command": "uv run herd.py new donna"}, tool_response={})  # registers this "session" as the brain
    for aid, name, role in (("ben1", "Ben", "Writes the server"), ("maya1", "Maya", "Builds the quiz")):  # Ben: a male look, Maya: the first female look (chloe)
        if ENGINE == 'codex':
            project = Path(os.environ['HIGGS_HOME'])/name
            project.mkdir()
            (project/'WORKER.md').write_text(MAYA if name=='Maya' else role, encoding='utf-8')
            herd.new(name, kind='codex', project=str(project))
            herd.send(name, 'Read WORKER.md. That records your actual assignment. Confirm it briefly in first person; do not change files.')
            continue
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
        time.sleep(0.01 if QUIET.is_set() else 0.2)  # #49: fast enough to land a take while bridge.backend() is still in herd.send


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
    end = time.time() + 40  # #61: from task_status's office rows or from the brain's say, either is fine
    while "Maya" not in wait_log("VOICE", max(1, end - time.time())): pass
    time.sleep(2)
    type_("Okay, can you put Maya on?")  # #73: the 12:53 call's "put Leo on" (Maya is this office's worker); "get me on the line" is in the selftest
    wait_log("transfer: putting the user through to Maya", 40)
    wait_log("event call.transfer", 30)
    assert "voice: chloe" in wait_log("session ready", 30)  # Maya's voice: office.json workers[].voice (the first female look)
    assert herd.office()["call"].get("with") == "maya1", herd.office()["call"]  # the office walks her to the phone
    assert "Maya" in wait_log("VOICE", 20)  # "Hey, it's Maya."
    time.sleep(2)
    type_("How long is the timer on each question?")
    wait_log("DELEGATION", 20); wait_log("→ inbox", 10)  # #61: the inbox line is written just after the DELEGATION log line
    assert herd.lines(herd.root() / "donna" / "inbox.jsonl")[-1].get("with") == "Maya"  # the brain forwards it to her
    wait_log("→ commentary", 40); v = wait_log("VOICE", 20).lower(); assert "thirty" in v or "30" in v, v  # her own transcript's answer
    time.sleep(2)
    type_("Why did you pick that interval length?")  # #82: a question stays a question (the 13:29 call made it "change the interval length")
    t = wait_log("DELEGATION", 20).lower(); assert "why" in t and "interval" in t and "change" not in t, t
    wait_log("→ commentary", 40); wait_log("VOICE", 20)
    time.sleep(2)
    type_("Great, thanks. Get me back to Donna.")  # #82: not only "put Donna back on"
    wait_log("back phrase heard", 40)
    assert "voice: nora" in wait_log("session ready", 30)
    assert herd.office()["call"].get("with") == "donna", herd.office()["call"]
    assert "Donna" in wait_log("VOICE", 20)  # "Hey, it's Donna again."
    time.sleep(2)
    type_("Thanks, bye")
    wait_log("call.ended", 30)


def fast_take_flow(herd, wait_log, type_):  # #49: offline, the old order (seek after herd.send) missed 8/20 takes from a 20 ms brain
    QUIET.set()
    wait_log("ring: waiting", 30)
    type_("")  # Enter: call Donna
    wait_log("session ready", 30)
    time.sleep(1)
    for req in ("Archive the photos folder.", "Also zip the music folder.", "And make a backup of the notes folder."):
        type_(req)
        wait_log("→ inbox", 30)
        wait_log("~ note: started", 5)  # the take reached backend()
        time.sleep(2)
    try:
        wait_log("no take for", 22)  # 20 s after the last task: a missed take shows up here
    except TimeoutError:
        pass
    else:
        raise AssertionError("a take was missed: false deaf-brain note")
    type_("Thanks, bye")
    wait_log("call.ended", 40)


NOUNS = ("photo", "music", "note")


def spoken(log):  # (kind, value) from bridge.log in order: ("task", (did, noun)), ("result", did), ("voice", line), ("fabricated", line)
    for l in log.splitlines():
        if m := re.search(r"DELEGATION (\S+) @\d+ms: (.*)", l): yield "task", (m[1], next((n for n in NOUNS if n in m[2].lower()), None))
        elif m := re.search(r"→ (?:commentary|attached held result) (\S+)", l): yield "result", m[1]
        elif m := re.search(r"VOICE[^:]*: (.*)", l): yield "voice", m[1]
        elif "fabricated:" in l: yield "fabricated", l


def judge(log):  # #55: in each result's reply, claims (no LATER word) naming a task whose result has not gone in, or any task when the reply never names its own
    import higgslive
    noun, told, bad, named, fab, last = {}, set(), [], 0, 0, None
    for kind, v in spoken(log):
        if kind == "task": noun[v[0]] = v[1]
        elif kind == "result": last = noun.get(v); told.add(last)
        elif kind == "fabricated": fab += 1
        elif last:  # "still zipping the music" is no claim; "the notes are archived" is (DONE lacks "archived")
            own = last in v.lower(); named += own; ok = told if own else set()
            bad += [v for s in higgslive.sentences(v) if not higgslive.LATER.search(s) for n in NOUNS if n in s and n not in ok]
            last = None
    return bad, named, fab


def false_claims(voice, about=""):  # done claims (higgslive.fabricated, sentence by sentence) that mention `about`
    import higgslive
    return [p for v in voice for p in re.split(r"(?<=[.!?;\]}])\s+", v) if about in p.lower() and higgslive.fabricated(p)]


def order_flow(herd, wait_log, type_):  # #55: on main a bare "Done." for the photos archive was told as the notes backup
    ORDER.set()
    wait_log("ring: waiting", 30)
    type_("")
    wait_log("session ready", 30)
    time.sleep(1)
    for req in ("Archive the photos folder.", "Also zip the music folder.", "And make a backup of the notes folder."):
        type_(req)
        wait_log("→ inbox", 30)
        wait_log("~ note: started", 5)
        time.sleep(2)
    for _ in NOUNS:
        wait_log("backend done for", 40)
    time.sleep(8)  # the last reply
    bad, named, fab = judge(wait_log.tail())
    print(f"#55 order: misattributed {len(bad)}, replies naming their task {named}/3, guard swaps {fab}", *bad, sep="\n  ", flush=True)
    type_("Thanks, bye")
    wait_log("call.ended", 30)
    assert not bad, bad


def bye_race_flow(herd, wait_log, type_, result=True):  # #55: the #49 run's goodbye swapped a true "The music folder zip is all set." ("backed up" is a DONE word, "zipped" is not)
    RACE.set()
    wait_log("ring: waiting", 30)
    type_("")
    wait_log("session ready", 30)
    time.sleep(1)
    for req in ("Back up the music folder.", "And make a backup of the notes folder."):
        type_(req)
        wait_log("→ inbox", 30)
        wait_log("~ note: started", 5)
        time.sleep(2)
    time.sleep(3)  # past the quiet beat: the result goes straight in, its reply in flight when the user says bye
    at = len(wait_log.tail())
    if result:
        GO.set()
        wait_log("backend done for", 10)
        time.sleep(0.5)
    type_("Thanks, bye")
    wait_log("call.ended", 40)
    after = wait_log.tail()[at:]
    voice = [v for k, v in spoken(after) if k == "voice"]
    claims = false_claims(voice, "note" if result else "")  # with a result: done claims about the notes backup
    music = any("music" in v.lower() for v in voice)
    print(f"#55 bye-race {'result' if result else 'control'}: music result spoken {music}, false done claims spoken {len(claims)}, "
          f"guard swaps {after.count('fabricated:')}", *voice, sep="\n  ", flush=True)
    assert not claims and (music or not result), voice


def demo(flow):
    tmp = tempfile.mkdtemp()
    os.environ["HIGGS_HOME"] = os.environ["HIGGS_DIR"] = tmp
    threading.Thread(target=agent, daemon=True).start()
    import herd
    logf = REPO / "bridge.log"
    start = logf.stat().st_size if logf.exists() else 0
    bridge = subprocess.Popen([sys.executable, "-X", "utf8", "bridge.py", "--ring", "--silent", "--backend", "session", "--voice", "nora", "--max-seconds", "90"],
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
    wait_log.tail = tail

    def type_(text):
        bridge.stdin.write(text + "\n"); bridge.stdin.flush()

    ok = False
    try:
        flow(herd, wait_log, type_)
        ok = True
    except Exception as e:
        print(f"FAILED: {e!r}")
    finally:
        if os.name == 'nt': bridge.terminate()
        else: os.killpg(bridge.pid, signal.SIGTERM)
        try: bridge.wait(10)
        except subprocess.TimeoutExpired:
            if os.name == 'nt': bridge.kill()
            else: os.killpg(bridge.pid, signal.SIGKILL)
        print(tail())
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    flows = {"--demo": ask_flow, "--transfer": transfer_flow, "--fast-take": fast_take_flow, "--order": order_flow,
             "--bye-race": (lambda *a: bye_race_flow(*a, result="--control" not in sys.argv))}
    demo(next(f for k, f in flows.items() if k in sys.argv)) if any(k in sys.argv for k in flows) else agent()
