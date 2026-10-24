# /// script
# dependencies = ["sounddevice", "websockets>=13"]
# ///
"""Voice bridge: Higgs Realtime on the mic and speaker, a Claude Code session (or `claude -p`) as the brain.

  uv run bridge.py                        # mic + speaker; backend = headless `claude -p` in ./sandbox (or --project DIR)
  uv run bridge.py --backend session      # the /call skill: tasks go to Donna's herd inbox (herd.py send), answers come from her outbox
  uv run bridge.py --backend fake         # 6 s sleep instead of Claude (no Claude credits)
  uv run bridge.py --text "a | b"         # headless: typed turns instead of the mic; exits after the last result is spoken
  uv run bridge.py --silence-ms 1000      # VAD silence before a turn ends (live mic default 800 ms; --text/--wav keep the server's 500)
  uv run bridge.py --ring --backend session   # Donna's phone: no call open; a `say` in ~/.higgs/herd/donna/outbox.jsonl rings,
                                          # Enter (or the office's Call Donna button) calls her; hangs up on "bye", Hang up, 60 s of silence or Higgs idle timeout
                                          # every call starts with ~/.higgs/herd/donna/context.txt; tasks go through herd.py send
  uv run bridge.py --ring --silent        # headless Donna phone: each stdin line is Enter (no call open) or a typed turn (on a call)
  uv run bridge.py --ring --backend session --brain ~/projects/app   # also start the brain: Claude Code on /call in tmux `donna`
                                          # (tmux attach -t donna to watch or type); each new task is typed into it, waking it
  uv run bridge.py … --brain ~/projects/app --brain-engine codex   # the brain on Codex (#66): workers are herd.py codex agents
  uv run bridge.py selftest               # offline checks (idle policy, sign-off, prompt size), no API call

Transfer (#28): the brain answers "get me Maya on the line" with `herd.py reply donna ID transfer Maya`; the bridge ends that
Higgs session after the voice says so, plays a hold cue and opens a fresh one in Maya's voice (office.json workers[].voice) with
worker_prompt; her turns go to the brain marked "with": "Maya"; "Putting Donna back on." (BACK) or 60 s of quiet opens Donna again.

Session backend: delegations land in ~/.higgs/herd/donna/inbox.jsonl through herd.send, one JSON line each: {"id", "task",
"transcript": [[role, text], ...last 12], "replaces"?, ...}; the brain answers with `herd.py reply donna ID take|note|ask|say|fail`.
The call's seed is herd/donna/context.txt (session backend or --ring), else ~/.higgs/context.txt; if present it is sent to the
voice at the start of the call (first 4000 chars). If its first line is
`Calling about: <reason>` the voice speaks first and says why it's calling. The delegation layer itself is higgslive.py.
While running, the bridge writes ~/.higgs/state.json ({"state": off|ringing|listening|thinking|speaking, "armed": --ring}, every
250 ms, `off` last); --ring also reads ~/.higgs/phone.cmd (`call`|`hangup`, the office's button, #75) and re-renders ~/.higgs/office.json every second (herd.write_office, docs/office-state.md).
"""
import argparse, asyncio, base64, contextlib, json, logging, os, queue, re, sys, threading, time

SIGN_OFF = "Hanging up now."   # the voice ends every goodbye with this (PROMPT); hearing it closes the call. The only copy: docs and the skill name it, code imports it
BACK = "Putting Donna back on."   # #28: a worker's voice ends its part with this (worker_prompt); hearing it puts Donna back on the line
IDLE_AFTER, NUDGE_AT, WARN_BEFORE = 60, 30, 10   # Mike's idle policy: nudge at 30 s of quiet, a cue at 50 s, hang up at 60 s; never while a task is pending
NUDGE = "[note] The user has been quiet for a while. Ask once, in a few words, whether they're still there."

def idle_action(now: float, active_at: float, spk_at: float, pending: bool, done: dict) -> str | None:
    """"nudge", "warn" or "hangup" once per silence, else None (Mike's bridge.py). A pending delegation never counts as quiet;
    `done` maps what already fired to when and is cleared when the quiet ends. The nudge's own reply (voice audio after it)
    does not end the quiet; only a user word or a result does."""
    quiet = 0 if pending else now - max(active_at, spk_at if spk_at <= done.get("nudge", spk_at) else done["nudge"] - NUDGE_AT)
    if quiet < NUDGE_AT: done.clear()
    action = "hangup" if quiet >= IDLE_AFTER else "warn" if quiet >= IDLE_AFTER - WARN_BEFORE else "nudge" if quiet >= NUDGE_AT else None
    if action is None or action in done: return None
    done[action] = now
    return action

def deaf_once(st: dict) -> bool:
    """#48: the deaf-brain note at most once per call: True the first time a task goes unheard; any word from the brain
    (take, note, ask, result) clears st["deaf"], so a brain that comes back and goes quiet again gets one more."""
    if st.get("deaf"): return False
    st["deaf"] = True
    return True

def phone_cmd(path: str) -> str | None:
    """#75: the office's Call Donna / Hang up button writes `call` or `hangup` to $HIGGS_HOME/phone.cmd; read it once and delete it."""
    try:
        with open(path) as f: cmd = f.read().strip()
        os.remove(path); return cmd
    except OSError: return None

ECHO_TAIL = 0.3   # s: the voice's audio counts as audible this long after its estimated end (output latency, room echo)

def find_device(devices, name: str, kind: str) -> int | None:
    """Index of the first `kind` ("input"/"output") device whose name contains `name`, any case; None if none does (#34)."""
    return next((i for i, d in enumerate(devices) if name.lower() in d["name"].lower() and d[f"max_{kind}_channels"] > 0), None)

def echo_of(heard: str, said: str) -> bool:
    """`heard` (a user transcript) is the mic picking up `said` (the voice's last line): two or more words, at least four in five
    of them found in order in `said`. Oct 24 08:30 call: "You asked me." after "You asked me to call." (#34)."""
    import difflib
    w = lambda s: re.findall(r"[a-z0-9']+", s.lower().replace("’", "'"))
    h, s = w(heard), w(said)
    return len(h) >= 2 and sum(b.size for b in difflib.SequenceMatcher(None, h, s, autojunk=False).get_matching_blocks()) >= 0.8 * len(h)

import higgslive

RATE = 24000
HIGGS_DIR = os.path.expanduser(os.environ.get("HIGGS_DIR") or os.environ.get("HIGGS_HOME") or "~/.higgs")
os.environ.setdefault("HIGGS_HOME", HIGGS_DIR)   # herd.py (imported below) reads HIGGS_HOME: keep both on the same directory
import herd
HERD = os.path.join(HIGGS_DIR, "herd"); EVENTS = os.path.join(HERD, "events.jsonl"); DONNA = os.path.join(HERD, "donna")
OUTBOX = os.path.join(DONNA, "outbox.jsonl")   # the session backend's only reply path: herd.py reply donna (one inbox path, #32)
STATE = os.path.join(HIGGS_DIR, "state.json")
PHONE_CMD = os.path.join(HIGGS_DIR, "phone.cmd")   # #75: the office's button (POST /agency-api/phone) writes call|hangup here
HANG_UP = object()   # ring: TYPED item for the office's Hang up
CALLING_ABOUT = "Calling about:"
PICKUP = '[note] The user just called you. Pick up: say exactly "Hey, it\'s Donna. What do you need?"'   # #12: Enter rings her; she answers like a phone

# Mike's prompt.txt as the model. Measured Oct 24 with probe/r26 (text mode, higgs-realtime): first-turn delegation 24/24 (the old
# prompt 29/30); an example ack line here ("I'll get the page started") made the model say it WITHOUT calling the tool (8/12).
# #56 (probe/r56/voice.py, same mode): "the office" vocabulary and the open-question rule; first turn still 24/24.
PROMPT = f"""# Role
You're Donna, the user's secretary, on a call with them. You handle the conversation; the office, reached with delegate_task, does the work: files, code, pages, commands, git, anything to look up. There is no set topic: the user decides what to talk about. Never invent a topic or something you were "supposed to" discuss.

# The office
The office is the user's computer, where named people take the jobs you send. Until task_status names who has a job, the office has it: never say an agent, someone or the team is on it, even in the user's words, nor that you do it yourself. After delegate_task, say in a few words that the office has it. Asked who is doing a job, or whether you are, call task_status and name whoever it names; its "donna" is the office's lead, not you.

# Tone
Warm, brief, competent, a little humor. Talk like a person: contractions, one or two short sentences a turn. Never say the same sentence twice in a call; no stock lines. Brisk pace.

# What you answer yourself
Only greetings, repeating or rephrasing something you already said, asking the user to repeat when you could not make them out, and acknowledging a correction. Everything else is a delegation: anything to make, open, run, check, find, change, improve or look up, anything about the user's files, projects or plans, asking to talk to whoever built something, and anything you are not sure of. Open questions too ("what could we be doing right now?", "what's next?", "any ideas?"): call delegate_task with the question; the office knows their projects and suggests. task_status only reports work already sent. Never refuse a topic or guess. A vague request ("make me a game", "improve it", "a page about this") is one too: call delegate_task with it as you heard it; the office reads their files and asks back if it needs more.

# While a task is pending
A pending task changes nothing about the user's next words: a new request or a question about the work is a new delegate_task; small talk gets small talk, without the task; only a plain "how's it going" gets a short status.

# Results
Never read file names, paths, ids, code or markdown aloud; say "the config file", not its path. Numbers in words.

# Unclear audio
If the user's words are unclear, cut off or make no sense, ask them once, briefly, to say it again. Never delegate on a guess. If you hear only silence, typing or background noise, say nothing.

# Corrections
If the user changes or corrects a request while you wait, the new version is the request: call delegate_task with the full corrected request and replaces set to true, and ignore a result that answers the old version.

# Ending the call
When the user says they are done ("that's all", "bye", "thanks, I'm good"), say a one-line goodbye ending with the exact words "{SIGN_OFF}" Those words close the call. Never say them in any other situation. If a task is still pending, the goodbye says you'll call them back with the result; never say or imply it finished."""

def worker_prompt(name: str, project: str, what: str, recent: str) -> str:
    """#28: the voice of a worker the user was put through to (a fresh session in their voice). Each question goes through
    delegate_task; the brain forwards it to that worker (SendMessage) and says the worker's answer back."""
    return f"""# Role
You're {name}, a developer on {project}. Donna, the user's secretary, just put the user through to you on the phone.{f" You worked on: {what}." if what else ""} Speak for yourself only: first person, one or two short sentences, no file paths, ids or code. There is no set topic.

# Every question
Every question or request about your work or anything else: call delegate_task with the user's words first, in that same turn, with at most one short holding line ("Let me check my notes." or "One sec."). Then say nothing more until the answer arrives. You know nothing about your work yourself: never answer, explain, guess or give a reason from general knowledge, not even a plausible one. The real {name} answers; the answer arrives as the tool's output: say it in your own words, in first person, as something you did and remember, never as something you looked up. Only greetings, putting Donna back, and repeating what you just said you answer yourself. Anything outside your work is Donna's: offer to put her back.

# Back to Donna
When the user wants Donna back or is done with you ("put Donna back", "that's all", "transfer me back"), say a short goodbye ending with the exact words "{BACK}" When the user says goodbye to the whole call, end with the exact words "{SIGN_OFF}" Never say either in any other situation.

# The call so far
{recent}"""

if sys.argv[1:2] == ["selftest"]:   # offline: no session, no audio
    assert len(PROMPT) <= 3000 and PROMPT.count(SIGN_OFF) == 1, len(PROMPT)
    wp = worker_prompt("Maya", "the kids site", "Builds the quiz", "user: who built the quiz?")
    assert wp.count(BACK) == 1 and wp.count(SIGN_OFF) == 1 and "You worked on: Builds the quiz." in wp and len(wp) < 2000, len(wp)
    done: dict = {}   # idle_action on a fake clock, speech at t=100 (Mike's cases)
    acts = [idle_action(t, 100, 0, False, done) for t in (110, 129, 130, 131, 149, 150, 151, 159, 160, 161)]
    assert acts == [None, None, "nudge", None, None, "warn", None, None, "hangup", None], acts
    assert idle_action(200, 190, 0, False, done) is None and not done   # speech resets: the next silence nudges again
    assert idle_action(220, 190, 0, False, done) == "nudge" and idle_action(250, 190, 215, False, done) is None   # voice audio at 215 resets too
    done.clear()   # the nudge's own reply (voice audio at 131-133) must not reset the clock
    nudges = [idle_action(t, 100, spk, False, done) for t, spk in ((130, 0), (132, 131), (133, 132), (140, 133), (149, 133), (150, 133), (159, 133), (160, 133))]
    assert nudges == ["nudge", None, None, None, None, "warn", None, "hangup"], nudges
    assert idle_action(1000, 0, 0, True, {}) is None   # never while a task is pending
    cs: dict = {}   # #48: three tasks to a deaf brain: one note; the brain answers (st["deaf"] cleared), goes quiet again: one more
    assert [deaf_once(cs) for _ in range(3)] == [True, False, False]; cs["deaf"] = False; assert [deaf_once(cs), deaf_once(cs)] == [True, False]
    devs = [{"name": "MacBook Pro Microphone", "max_input_channels": 1, "max_output_channels": 0},
            {"name": "MacBook Pro Speakers", "max_input_channels": 0, "max_output_channels": 2}, {"name": "EarPods", "max_input_channels": 0, "max_output_channels": 2}]
    assert (find_device(devs, "macbook", "input"), find_device(devs, "MacBook", "output"), find_device(devs, "earpods", "output")) == (0, 1, 2)
    assert find_device(devs, "AirPods", "output") is None and find_device(devs, "EarPods", "input") is None   # no match, or no channels of that kind
    assert all(echo_of(h, s) for h, s in (("You asked me.", "You asked me to call."), ("You asked me to.", "You asked me to call."), ("Still running.", "It's still running."),
                                          ("No need to check.", "Got it, no need to check on that. I'm just waiting for the task to finish up.")))   # the 08:30 call
    assert not any(echo_of(h, s) for h, s in (("On that now. No, you don't have to check on that. Um.", "I'm checking on that now."),   # echo + the user's own words
                                              ("Blue.", "Should the page be blue or green?"), ("Blue, please.", "Should the page be blue or green?"), ("They'll run it.", "It's still running.")))
    import tempfile; cf = os.path.join(tempfile.mkdtemp(), "phone.cmd")   # #75: read once, then gone
    assert phone_cmd(cf) is None; open(cf, "w").write("call\n"); assert phone_cmd(cf) == "call" and phone_cmd(cf) is None and not os.path.exists(cf)
    print("ok"); sys.exit(0)

ap = argparse.ArgumentParser()
ap.add_argument("--backend", choices=["session", "claude", "codex", "fake"], default="claude",
                help="session: any coding agent (Claude Code, Codex, …) on the /call skill answers through the herd (herd.py reply donna); claude/codex: headless CLI in --project")
ap.add_argument("--text", help="headless: typed user turns separated by |, instead of the mic")
ap.add_argument("--silent", action="store_true", help="do not play audio")
ap.add_argument("--wav", help="debug: stream this 24 kHz mono 16-bit WAV as the mic, in real time")
ap.add_argument("--max-seconds", type=float, default=0, help="debug: hang up after this many seconds")
ap.add_argument("--model", default="higgs-realtime", help="higgs-realtime or higgs-realtime-1.5-preview")
ap.add_argument("--voice", default="default", help="default, chloe, eleanor, jake, marcus, nora, oliver")
ap.add_argument("--mic", help="substring of the input device name, e.g. MacBook")
ap.add_argument("--out", help="substring of the output device name, e.g. AirPods")
ap.add_argument("--project", help="directory the claude backend works in (default: ./sandbox)")
ap.add_argument("--ring", action="store_true", help="no session until Donna's outbox gets a `say` (or you press Enter); one call at a time, then wait again")
ap.add_argument("--silence-ms", type=int, help="server VAD silence (ms) that ends a user turn; default 800 on a live mic, server default (500) otherwise")
ap.add_argument("--brain", metavar="REPO", help="start Donna's brain first (Claude Code on the /call skill, working in REPO) in tmux session `donna`, unless it runs already")
ap.add_argument("--brain-model", metavar="MODEL", help="the brain's model, passed to claude --model (e.g. sonnet, opus) or codex -m; default: the CLI's own default")
ap.add_argument("--brain-engine", choices=["claude", "codex"], default="claude", help="#66: the CLI --brain runs: Claude Code (default) or Codex (workers through herd.py, no hooks)")
args = ap.parse_args()
if args.ring and args.text: ap.error("--ring cannot be combined with --text")
CONTEXT = os.path.join(DONNA if args.ring or args.backend == "session" else HIGGS_DIR, "context.txt")   # Donna's seed (the skill writes it)
MIC = not (args.wav or args.text or args.ring and args.silent)   # a live mic: real speech pauses longer than TTS
HERE = os.path.dirname(os.path.abspath(__file__))
SANDBOX = os.path.abspath(os.path.expanduser(args.project)) if args.project else os.path.join(HERE, "sandbox")
DEAF_AFTER = 20   # seconds with no take before the voice tells the user the brain is not answering (#38)
DEAF = "[note] Nobody on the computer has picked up the task you sent. Tell the user in one sentence that the brain is not answering and that typing anything in its window wakes it."

T0 = time.monotonic()
LOGF = open(os.path.join(HERE, "bridge.log"), "a")
LOGF.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(sys.argv[1:])}\n")
def log(*a):
    line = f"[{time.monotonic()-T0:6.2f}s] " + " ".join(str(x) for x in a)
    print(line, flush=True); LOGF.write(line + "\n"); LOGF.flush()
class _H(logging.Handler):
    def emit(self, r): log(r.getMessage())
logging.getLogger("higgslive").addHandler(_H()); logging.getLogger("higgslive").setLevel(logging.INFO)

DEV: dict = {}   # "input"/"output" → the --mic/--out device, resolved once at start (#34); absent = the system default
ECHO = False     # speakers + built-in mic: the mic hears the voice
if MIC or not args.silent:
    import sounddevice as sd
    for kind, name in (("output", None if args.silent else args.out), ("input", args.mic if MIC else None)):
        if not name: continue
        DEV[kind] = find_device(sd.query_devices(), name, kind)
        if DEV[kind] is None:   # used to fall back to the default silently: --out AirPods with no AirPods played on the speakers (#34)
            print(sd.query_devices(), file=sys.stderr); ap.error(f"--{'out' if kind == 'output' else 'mic'} {name!r} matches no {kind} device (list above)")   # exit 2; --ring never arms
    if ECHO := MIC and not args.silent and all("macbook" in sd.query_devices(DEV.get(k), k)["name"].lower() for k in ("input", "output")):   # ponytail: MacBook names only; add other built-in pairs if they echo
        log("echo guard: MacBook speakers + MacBook mic, so the mic hears Donna; it is muted while she talks, so you cannot talk over her. Headphones lift this.")

SESSION: dict = {}             # the backend Claude Code session id, kept for the length of the call
BACKEND_LOCK = asyncio.Lock()  # one agent: tasks run one at a time, in order
CLAIMED: set = set()           # ring: delegation ids; backend() reads their say/note itself, so the outbox watcher skips them
SAYS: asyncio.Queue = asyncio.Queue()   # ring: (kind, id, text) of unclaimed say/ask/fail lines (the agent calling the user)
TYPED: asyncio.Queue = asyncio.Queue()  # ring: stdin lines: Enter while no call is open, a typed turn on a call
ASK = {"did": None}            # the task whose question was just asked aloud; the user's next words answer it
BYE = re.compile(r"\b(bye|goodbye|that'?s all|talk (to you )?later|hang up)\b")   # ring: the user's goodbye, a fallback for a voice that skips SIGN_OFF
NOW: dict = {"call": None, "ringing": False, "with": None}   # the open call's state dict (None = no call); state.json is read off it; with: who the user talks to (#28)
TURNS = [t.strip() for t in args.text.split("|")] if args.text else []   # --text: the typed turns, across every segment of the call

def call_state(now: float) -> str:   # state.json's word (Mike's contract): thinking = a delegation has no result yet
    c = NOW["call"]
    if not c: return "ringing" if NOW["ringing"] else "off"
    return "speaking" if now < c["play_until"] else "thinking" if c["pending"] else "listening"

def write_state(s: str, armed: bool | None = None):   # armed: a --ring phone is running (#75: the office's Call Donna button)
    try:
        with open(STATE + ".tmp", "w") as f: json.dump({"state": s, "armed": args.ring if armed is None else armed, **({"with": NOW["with"]} if NOW["with"] and s != "off" else {})}, f)
        os.replace(STATE + ".tmp", STATE)
    except OSError: pass

async def state_loop():   # every 250 ms while the bridge runs; office.json every second (the hook re-renders it on every tool call too)
    n = 0
    while True:
        write_state(call_state(time.monotonic()))
        if n % 4 == 0:
            try: herd.write_office()
            except Exception as e: log("office.json write failed:", repr(e)) if n == 0 else None
        n += 1; await asyncio.sleep(0.25)

def worker_on() -> str | None:   # the worker the user is talking to (#28), None while it is Donna
    return NOW["with"] if NOW["with"] not in (None, "donna") else None

def forward_answer(text, transcript):
    """The user's next words answer the question Donna asked for task ASK["did"]: hand them back to her as an inbox line."""
    did, ASK["did"] = ASK["did"], None
    if not did: return
    log(f"answer → donna {did}: {text}")
    try: herd.send("donna", text, None, "voice", reply_to=did, transcript=transcript, with_=worker_on())
    except SystemExit: log("answer not delivered: Donna is not on duty")

def summarize_tool(name, inp):
    if inp.get("description"): return str(inp["description"])[:60].lower()
    arg = inp.get("file_path") or inp.get("command") or inp.get("pattern") or inp.get("path") or ""
    arg = os.path.basename(str(arg)) if name in ("Read", "Write", "Edit") else str(arg)[:50]
    verb = {"Read": "reading", "Write": "writing", "Edit": "editing", "Bash": "running", "Glob": "searching for", "Grep": "searching"}.get(name, name.lower())
    return f"{verb} {arg}".strip()

async def backend(did: str, task: str, transcript: list, progress, ask, replaces=None) -> tuple[str, str]:
    """Run the task; await progress(text) per step, ask(text) for a question to the user; return (≤3 spoken sentences: facts, status, next step; kind say|fail).
    transcript: the call's last turns as [role, text]; replaces: the delegation id this one corrects (its result is dropped by higgslive)."""
    context = "\n".join(f"{r}: {t}" for r, t in transcript)
    if args.backend == "session":
        os.makedirs(os.path.dirname(OUTBOX), exist_ok=True); open(OUTBOX, "a").close()
        with open(OUTBOX) as f:
            f.seek(0, 2)   # before the send: a reply faster than the send's own bookkeeping (a scripted brain, #28 run) was missed
            try: herd.send("donna", task, None, "voice", tid=did, transcript=transcript, replaces=replaces, with_=worker_on())   # task.sent + unread fire; the call_id stays the line's id for the outbox match below
            except SystemExit: return "Donna isn't on duty right now, so I couldn't hand that off.", "fail"
            log(f"  → inbox {did}")
            t0 = time.monotonic()
            while time.monotonic() - t0 < 600:
                line = f.readline()
                if not line: await asyncio.sleep(0.2); continue
                try: msg = json.loads(line)
                except Exception: continue
                if msg.get("id") != did: continue
                k = msg["kind"]
                if k == "take": await progress("started")
                elif k == "note": await progress(msg["text"])
                elif k == "ask": await ask(msg["text"])   # the task is not finished: keep reading
                else: return msg["text"][:800], k if k in ("fail", "transfer") else "say"
        return "The session did not answer within ten minutes.", "fail"
    if args.backend == "fake":
        for step in ("looking at the folder", "writing the file", "opening it"):
            await asyncio.sleep(2); await progress(step)
        return "Done. The file is written and open in the browser. Nothing else needed.", "say"
    if args.backend == "codex":   # ponytail: UNTESTED here (this Mac's codex is not logged in); event names from `codex exec --json`
        prompt = f"## Voice conversation context\n{context or '(none)'}\n\n## Task\n{task}\n\n## Return the result\nDo the task in the current directory. Then reply in at most three plain sentences for a voice assistant to speak: facts, status, next step. No code, no markdown, no file paths unless essential."
        cmd = ["codex", "exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-C", SANDBOX] + (["resume", SESSION["id"], prompt] if SESSION.get("id") else [prompt])
        p = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, cwd=SANDBOX)
        result = None
        try:
            async with asyncio.timeout(120):
                async for raw in p.stdout:
                    try: ev = json.loads(raw)
                    except Exception: continue
                    if ev.get("type") == "thread.started" and ev.get("thread_id"): SESSION["id"] = ev["thread_id"]
                    it = ev.get("item", {}) if ev.get("type") == "item.completed" else {}
                    if it.get("type") == "command_execution": await progress("running " + str(it.get("command", ""))[:50])
                    elif it.get("type") == "file_change": await progress("editing " + ", ".join(os.path.basename(c.get("path", "")) for c in it.get("changes", []))[:50])
                    elif it.get("type") == "agent_message": result = it.get("text")
                    elif ev.get("type") == "turn.failed": result = "the backend reported an error"
        except TimeoutError:
            p.kill(); return "The backend timed out after two minutes.", "say"
        return (result or "The backend returned nothing.")[:800], "say"
    prompt = f"""## Voice conversation context
{context or '(none)'}

## Task
{task}

## Return the result
Do the task in the current directory. Then reply in at most three plain sentences for a voice assistant to speak: facts, status, next step. No code, no markdown, no file paths unless essential."""
    resume = ["--resume", SESSION["id"]] if SESSION.get("id") else []
    p = await asyncio.create_subprocess_exec("claude", "-p", prompt, "--output-format", "stream-json", "--verbose", *resume,
        "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(ls:*),Bash(find:*),Bash(wc:*),Bash(git status:*),Bash(git log:*),Bash(git diff:*),Bash(du:*),Bash(open:*),Bash(mkdir:*),Bash(cat:*)",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, cwd=SANDBOX,
        env={k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"})   # bill the claude.ai login like the interactive session, not the API key in .zshrc
    result = None
    try:
        async with asyncio.timeout(120):
            async for raw in p.stdout:
                try: ev = json.loads(raw)
                except Exception: continue
                if ev.get("type") == "system" and ev.get("subtype") == "init" and ev.get("session_id"):
                    if not SESSION.get("id"): log(f"backend session {ev['session_id'][:8]}… (resumed for later tasks)")
                    SESSION["id"] = ev["session_id"]
                if ev.get("type") == "assistant":
                    for c in ev["message"]["content"]:
                        if c.get("type") == "tool_use": await progress(summarize_tool(c["name"], c.get("input", {})))
                elif ev.get("type") == "result":
                    result = ev.get("result") or ("the backend reported an error" if ev.get("is_error") else None)
    except TimeoutError:
        p.kill(); return "The backend timed out after two minutes.", "say"
    return (result or "The backend returned nothing.")[:800], "say"

def context_seed() -> str:
    return open(CONTEXT).read()[:4000].strip() if os.path.exists(CONTEXT) else ""

def event(ev, **kw):
    try:
        os.makedirs(HERD, exist_ok=True)
        with open(EVENTS, "a") as f: f.write(json.dumps({"ts": time.time(), "ev": ev, "agent": "donna", **kw}) + "\n")
    except OSError as e: log("event write failed:", e)
    log("event", ev, kw or "")

def set_state(s):
    try: herd.state("donna", s)   # herd.py writes the state + its own event
    except (SystemExit, Exception) as e: log("set_state failed:", repr(e))

async def watch_outbox():
    pos = os.path.getsize(OUTBOX) if os.path.exists(OUTBOX) else 0
    while True:
        await asyncio.sleep(0.3)
        try:
            if (size := os.path.getsize(OUTBOX)) < pos: pos = 0
            if size == pos: continue
            with open(OUTBOX, "rb") as f: f.seek(pos); data = f.read()
        except OSError: pos = 0; continue
        if b"\n" not in data: continue
        data = data[:data.rindex(b"\n") + 1]; pos += len(data)   # only complete lines
        for line in data.splitlines():
            try:
                m = json.loads(line)
                if m.get("kind") == "transfer" and not NOW["call"]: log(f"transfer to {m.get('text')} dropped: nobody is on the line"); continue   # never rings (#28)
                if m.get("kind") in ("say", "ask", "fail", "transfer") and m.get("text") and m.get("id") not in CLAIMED: SAYS.put_nowait((m["kind"], m["id"], m["text"]))
            except Exception: continue

async def call(seed: str, transcript: list, who: dict | None = None, opener: str | None = None) -> str:
    """One Higgs session, start to hang-up, or one segment of a call (#28): `who` = the worker the user was put through to
    ({name, voice, persona}), None for Donna; `opener` = what the voice says first. Returns why it ended: goodbye, silence, …,
    "transfer:<name>" or "back"."""
    spk: queue.Queue = queue.Queue(); loop = asyncio.get_running_loop()
    st = {"done": False, "pending": 0, "spoke_result": False, "act": time.monotonic(), "play_until": 0.0, "bye": None, "vs": False, "vu": False}   # act: last user word or result; play_until: estimated end of the voice's audio
    def end(reason):
        if not st["done"]: st.update(done=True, reason=reason)
    turns = TURNS   # transcript: [role, text], role "user"|"assistant" (Mike's shape), kept across segments; the last 12 go with every inbox line
    sd = None
    if not args.silent or not (args.text or args.wav or args.ring): import sounddevice as sd

    def spk_thread():
        try:
            odev = DEV.get("output")
            if args.out: loop.call_soon_threadsafe(log, f"speaker: {sd.query_devices(odev)['name']}")
            with sd.RawOutputStream(samplerate=RATE, channels=1, dtype="int16", device=odev) as out:
                import math, array
                if who or opener and opener is not PICKUP:   # a transfer (#28): the hold cue, two soft rising tones, while the next voice connects
                    out.write(b"".join(array.array("h", (int(a * math.sin(2 * math.pi * hz * i / RATE)) for i in range(RATE * 3 // 20))).tobytes() for hz, a in ((523, 3000), (0, 0), (659, 3000))))
                else:
                    out.write(array.array("h", (int(6000 * math.sin(2 * math.pi * 880 * i / RATE)) for i in range(RATE // 5))).tobytes())
                    loop.call_soon_threadsafe(log, "speaker: played a short beep — if you did not hear it, output is going to the wrong device")
                while (chunk := spk.get()) is not None: out.write(chunk)
        except Exception as e:
            loop.call_soon_threadsafe(log, f"SPEAKER THREAD CRASHED: {e!r}")
    if sd and not args.silent:
        d = sd.default.device; log(f"audio in: {sd.query_devices(d[0])['name']} | out: {sd.query_devices(d[1])['name']}")
        threading.Thread(target=spk_thread, daemon=True).start()
    def clear_spk():
        try:
            while True: spk.get_nowait()
        except queue.Empty: pass
    def cue():   # the idle warning 10 s before the hang-up: a soft tone, not words (speech would reset the quiet and cost a turn)
        import math, array
        if not args.silent: spk.put(array.array("h", (int(3000 * math.sin(2 * math.pi * 660 * i / RATE)) for i in range(RATE // 6))).tobytes())

    log("connecting…")
    async with higgslive.connect(playback=not args.silent, model=args.model) as conn:
        await conn.session.start(session={"instructions": who["persona"] if who else PROMPT, "delegation": {"type": "client"}, "voice": who["voice"] if who else args.voice,
            **({"relay": True} if who else {}),   # a worker's voice: every turn goes to the brain, and "I built it" is her history, not a made-up result
            **({"turn_detection": {"type": "server_vad", "silence_duration_ms": args.silence_ms or 800}} if MIC or args.silence_ms else {}),
            **({"input": [{"type": "message", "role": "developer", "content": [{"type": "input_text", "text": seed}]}]} if seed else {})})

        async def run_delegation(did, task, replaces=None):
            st["pending"] += 1
            try:
                sess = args.backend == "session"   # Donna's inbox is the queue; claude/codex are one agent at a time
                if not sess and BACKEND_LOCK.locked(): await conn.session.thinking.append(content="queued behind the current task", delegation_id=did)
                async with contextlib.nullcontext() if sess else BACKEND_LOCK:
                    t = time.monotonic(); log(f"backend started for {did}: {task[:90]}")
                    heard = asyncio.Event()   # the brain answered: take, note, ask or the result
                    def back(): heard.set(); st["deaf"] = False   # #48: the brain is back: a later silence may say the note again
                    async def progress(text): back(); await conn.session.thinking.append(content=text, delegation_id=did)
                    async def ask(text): back(); await conn.session.commentary.append(content=text, delegation_id=did, kind="ask"); ASK["did"] = did
                    async def deaf():   # #38: its wait loop died and nothing woke it (no tmux), or it is busy with something else
                        await asyncio.sleep(DEAF_AFTER)
                        if heard.is_set(): return
                        log(f"brain: no take for {did} in {DEAF_AFTER} s; it is not answering. Type anything in its window (tmux attach -t {herd.tmux_name()} if it runs there)")
                        if deaf_once(st): await conn.session.commentary.append(content=DEAF)   # once per call (#48): three tasks to a deaf brain, one sentence
                    if sess: tasks.append(asyncio.create_task(deaf()))
                    text, kind = await backend(did, task, [list(x) for x in transcript[-12:]], progress, ask, replaces); back()
                    log(f"backend done for {did} in {time.monotonic()-t:.1f}s")
                    if kind == "transfer": await put_through(text.strip(), did)
                    else: await conn.session.commentary.append(content=text, delegation_id=did, kind=kind)
            finally: st["pending"] -= 1

        async def put_through(name, did=None):   # #28: the brain said put them through: the voice says so, and the segment ends after that reply
            st["next"] = f"transfer:{name}"; log(f"transfer: putting the user through to {name}")
            await conn.session.commentary.append(content=("" if did else "[note] ") + f"Putting the user through to {name} now. Tell them in a few words, like: One sec, I'll put you through.",
                                                 delegation_id=did, kind="transfer")

        def check_bye(text):   # not with a worker: "that's all" means back to Donna there
            if args.ring and not who and BYE.search(text.lower().replace("’", "'")): st["bye"] = time.monotonic()   # no goodbye prompt: the model answers "bye" itself

        async def typed_turn(text):
            transcript.append(["user", text]); forward_answer(text, [list(x) for x in transcript[-12:]])
            log("USER (typed):", text); st["act"] = time.monotonic(); check_bye(text); await conn.input_text.append(text)

        async def guard_idle():   # Mike's policy; a typed --text run paces itself
            done: dict = {}
            while True:
                await asyncio.sleep(1); now = time.monotonic()
                if st["bye"] and now - st["bye"] > 8: end("goodbye"); return   # fallback: no response.done after the goodbye
                if st.get("switch") and now - st["switch"] > 8: end(st["next"]); return   # same for the put-through line
                a = idle_action(now, st["act"], st["play_until"], st["pending"] > 0, done)
                if a == "nudge": log(f"quiet for {NUDGE_AT} s, nudging"); await conn.session.commentary.append(content=NUDGE)
                elif a == "warn": log(f"idle cue: hanging up in {WARN_BEFORE} s"); cue()
                elif a == "hangup":   # with a worker, a quiet line goes back to Donna (#28)
                    log(f"idle for {IDLE_AFTER} s (no words, no audio, nothing pending), " + ("back to Donna" if who else "closing")); end("back" if who else "silence"); return

        tasks, stream = [], None
        if args.wav:
            async def play_wav():
                data = open(args.wav, "rb").read()[44:]; step = RATE // 10 * 2
                for i in range(0, len(data), step):
                    await conn.input_audio.append(data[i:i+step]); await asyncio.sleep(0.1)
                log("wav finished")
            tasks.append(asyncio.create_task(play_wav())); log("streaming wav as mic")
        elif MIC:   # ring+silent: headless, no mic
            import array
            meter = {"n": 0, "peak": 0}
            def on_mic(indata, frames, t, status):
                buf = bytes(indata); a = array.array("h", buf)
                if ECHO and time.monotonic() < st["play_until"] + ECHO_TAIL: buf = bytes(len(buf))   # zeros while she is audible: her echo (0.4-0.6) is louder than the user (≤0.15) on this mic, so no level bar or VAD threshold tells them apart (#34)
                asyncio.run_coroutine_threadsafe(conn.input_audio.append(buf), loop)
                meter["peak"] = max(meter["peak"], max(abs(x) for x in a) if a else 0); meter["n"] += 1
                if meter["n"] % 20 == 0:
                    lvl = meter["peak"] / 32768; meter["peak"] = 0
                    loop.call_soon_threadsafe(log, f"mic level {lvl:.3f}" + ("   <-- ZERO: terminal has no microphone permission" if lvl < 0.001 else ""))
            dev = DEV.get("input")
            if args.mic: log(f"mic: {sd.query_devices(dev)['name']}")
            stream = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=RATE // 10, callback=on_mic, device=dev); stream.start()
        if args.max_seconds:
            async def deadline(): await asyncio.sleep(args.max_seconds); end("max-seconds"); log("max-seconds reached")
            tasks.append(asyncio.create_task(deadline()))
        if args.ring:
            async def says():   # updates from the work sent off, arriving mid-call
                while True:
                    kind, sid, text = await SAYS.get()
                    if kind == "ask": await conn.session.commentary.append(content=text, delegation_id=sid, kind="ask"); ASK["did"] = sid
                    elif kind == "transfer": await put_through(text.strip())   # a worker the brain held for (busy, #28) is free now
                    elif kind == "fail": await conn.session.commentary.append(content=f"[note] Something you sent off could not be finished; tell the user in a sentence: {text}", delegation_id=sid, kind="fail")
                    else: await conn.session.commentary.append(content=f"[note] An update just came in from the work you sent off; tell the user in a sentence or two: {text}", delegation_id=sid, kind="say")   # the id: its commentary.appended marks it spoken
            async def typed():   # stdin lines on a call: typed turns (the headless check's only input)
                while True:
                    text = await TYPED.get()
                    if text is HANG_UP:   # #75: the office's Hang up: the voice says its goodbye, then the call closes (guard_idle: 8 s at most)
                        log("hang up from the office"); st["bye"] = time.monotonic()
                        try: await conn.session.commentary.append(content=f'[note] The user hung up. Say a one-line goodbye ending with the exact words "{SIGN_OFF}"')
                        except Exception: end("hangup")
                    elif text: await typed_turn(text)
            tasks += [asyncio.create_task(says()), asyncio.create_task(typed())]
        if not args.text: tasks.append(asyncio.create_task(guard_idle()))

        async def events():
            async for ev in conn:
                t = ev.type
                if os.environ.get("DEBUG") and t == "raw": log("  ev:", ev.raw_type)
                if t == "session.started":
                    log(f"session ready (backend: {args.backend}, voice: {ev.voice})"); NOW["ringing"] = False
                    if opener: await conn.session.commentary.append(content=opener)   # a transfer: "Hey, it's Maya." / "Hey, it's Donna again."
                    elif (first := seed.split("\n", 1)[0]).startswith(CALLING_ABOUT):   # the agent placed the call: the voice speaks first
                        await conn.session.commentary.append(content=f"You placed this call. Open by saying in a few words why you are calling: {first[len(CALLING_ABOUT):].strip()}.")
                    elif turns: await typed_turn(turns.pop(0))
                    elif not args.wav: log("mic live — talk. Ctrl-C to hang up.")
                elif t == "error": log("ERROR", ev.error)
                elif t == "session.closed": log("session closed:", ev.reason); end(ev.reason)
                elif t == "session.input_speech_started":   # VAD alone (noise can trigger it) does not restart the idle clock: words do
                    st["over"] = time.monotonic() < st["play_until"] + ECHO_TAIL   # began while the voice was audible: its transcript may be her echo (#34)
                    clear_spk(); st["play_until"] = 0.0; log("… user speaking (barge-in: playback cleared)")
                    if args.ring and not st["vu"]: st["vu"] = True; event("voice.user")
                elif t == "session.input_speech_stopped": st["vu"] = False
                elif t == "session.output_audio.discard": clear_spk(); st["play_until"] = 0.0; st.pop("audio_bytes", None)   # a reply that reported a result nobody sent (higgslive, #32)
                elif t == "session.input_transcript.done":
                    if st.get("over") and echo_of(ev.transcript, next((x for r, x in reversed(transcript) if r == "assistant"), "")):   # never the transcript, an answer or the idle clock (#34)
                        log("USER (her own words through the mic, dropped):", ev.transcript); continue
                    log("USER:", ev.transcript); transcript.append(["user", ev.transcript]); forward_answer(ev.transcript, [list(x) for x in transcript[-12:]])
                    st["vu"] = False
                    if ev.transcript.strip(): st["act"] = time.monotonic()
                    check_bye(ev.transcript)
                elif t == "session.output_audio.delta":
                    n = len(ev.delta) * 3 // 4; now = time.monotonic()
                    st["audio_bytes"] = st.get("audio_bytes", 0) + n; st["play_until"] = max(st["play_until"], now) + n / (RATE * 2)   # audio comes ~8x real time
                    if args.ring and not st["vs"]: st["vs"] = True; event("voice.speaking")
                    if not args.silent: spk.put(base64.b64decode(ev.delta))
                elif t == "session.output_transcript.done":
                    secs = st.pop("audio_bytes", 0) / (RATE * 2); words = len(ev.transcript.split())
                    log(f"VOICE ({secs:.1f}s, {words / secs * 60:.0f} wpm):" if secs > 0.5 else "VOICE:", ev.transcript); transcript.append(["assistant", ev.transcript])
                    if SIGN_OFF[:-1].lower() in ev.transcript.lower(): st["bye"] = time.monotonic(); log("sign-off heard, closing after this reply")
                    elif who and BACK[:-1].lower() in ev.transcript.lower(): st["back"] = True; log("back phrase heard, Donna after this reply")
                elif t == "session.delegation.created":
                    rep = getattr(ev.delegation, "replaces", None)
                    log(f"DELEGATION {ev.delegation.id} @{ev.offset_ms}ms: {ev.delegation.task[:90]}" + (f" (replaces {rep})" if rep else "")); st["delegated"] = True
                    CLAIMED.add(ev.delegation.id); tasks.append(asyncio.create_task(run_delegation(ev.delegation.id, ev.delegation.task, rep)))
                elif t == "session.commentary.appended" and ev.kind == "transfer": st["switch"] = time.monotonic()   # the put-through line is going out
                elif t == "session.commentary.appended" and ev.delegation_id:
                    if ev.kind in ("say", "fail"): event("task.spoken", id=ev.delegation_id)   # office: that briefing is presented (#31)
                    if ev.kind != "dropped": st["spoke_result"] = True; st["act"] = time.monotonic()   # a result restarts the idle clock
                    elif args.text and not turns and st["spoke_result"] and not st["pending"]: st["done"] = True   # the corrected result was already spoken
                elif t == "response.done":
                    st["vs"] = False
                    if st["bye"] and not ev.calls: end("goodbye")   # #12 rehearsal: "Open a pull request. Thanks, bye" closed on the call's response, before any goodbye was said
                    elif st.get("switch"): end(st["next"])
                    elif st.get("back"): end("back")
                    elif args.text and not ev.calls:   # headless pacing: next typed turn, or exit once everything is spoken
                        if turns: await asyncio.sleep(1.5); await typed_turn(turns.pop(0))
                        elif (st["spoke_result"] and not st["pending"]) or not st.get("delegated"):
                            if not st.get("delegated"): log("model answered WITHOUT delegating — nothing to wait for")
                            st["done"] = True
                if st["done"]: return
        ev_task = asyncio.create_task(events()); NOW["call"] = st
        try:
            while not st["done"]: await asyncio.sleep(0.2)
            while not args.silent and not spk.empty(): await asyncio.sleep(0.1)   # let the goodbye finish playing
            await asyncio.sleep(0.5 if args.silent else 3)
        finally:
            CLAIMED.clear()   # a task still running at hang-up (or a transfer): its later say rings or comes in the next segment (watch_outbox skips claimed ids)
            for t in tasks + [ev_task]: t.cancel()
            if stream: stream.stop(); stream.close()
            spk.put(None); log("closed")
    return st.get("reason", "done")

def worker(name: str, transcript: list) -> dict:
    """#28: who the user is put through to: voice and work from office.json's worker of that name (herd.office), else a stand-in."""
    o = herd.office()
    w = next((w for w in o["workers"][1:] if w["name"].lower() == name.lower()), {})
    what = next((a["title"] for a in o["assignments"] if a["id"] == w.get("assignmentId")), "")
    recent = "\n".join(f"{'user' if r == 'user' else 'Donna'}: {x}" for r, x in transcript[-6:])
    name = w.get("name") or name
    return {"name": name, "voice": w.get("voice") or "oliver", "persona": worker_prompt(name, (o["projects"] or [{}])[0].get("name") or "this project", what, recent)}

async def phone(seed: str, opener: str | None = None) -> str:
    """One call from the user's side: Donna, then maybe a worker and back (#28; a fresh Higgs session per segment, never a
    session.update mid-call). Returns why it ended."""
    transcript, who = [], None
    NOW["with"] = "donna"
    try:
        while True:
            start = len(transcript); reason = await call(seed, transcript, who, opener)
            if reason.startswith("transfer:"):
                who = worker(reason.split(":", 1)[1], transcript); NOW["with"] = who["name"]; event("call.transfer", to=who["name"])
                opener = f'[note] You are on the line now. Say exactly: "Hey, it\'s {who["name"]}."'
            elif reason == "back":
                seg = transcript[start:]; u = next((x for r, x in reversed(seg) if r == "user"), ""); a = next((x for r, x in reversed(seg) if r == "assistant"), "")
                seed = (context_seed() + f"\nYou put the user through to {who['name']}; they are back with you now.\n"
                        f"Last there, the user said: \"{u[:200]}\" and {who['name']} said: \"{a[:200]}\"").strip()
                who, NOW["with"] = None, "donna"; event("call.transfer", to="donna")
                opener = '[note] The user is back with you. Say exactly: "Hey, it\'s Donna again."'
            else: return reason
    finally: NOW.update(call=None, ringing=False, **{"with": None})

async def main():
    if not args.ring: await phone(context_seed()); return
    loop = asyncio.get_running_loop()
    def stdin_thread():
        try:
            while line := sys.stdin.readline(): loop.call_soon_threadsafe(TYPED.put_nowait, line.strip())   # "" = EOF (stdin is /dev/null): never an Enter
        except Exception: pass
    threading.Thread(target=stdin_thread, daemon=True).start()
    watcher = asyncio.create_task(watch_outbox())
    with contextlib.suppress(OSError): os.remove(PHONE_CMD)   # a click while the phone was down must not dial now
    async def watch_cmd():   # #75: the office's button, every 250 ms: call = Enter while no call is open, hangup ends the open one
        while True:
            await asyncio.sleep(0.25)
            if NOW["ringing"] or not (cmd := phone_cmd(PHONE_CMD)): continue   # ringing: the session is not up yet; the file waits
            if cmd == "call" and not NOW["call"]: TYPED.put_nowait("")
            elif cmd == "hangup" and NOW["call"]: TYPED.put_nowait(HANG_UP)
            else: log(f"phone.cmd {cmd!r} ignored ({call_state(time.monotonic())})")
    cmds = asyncio.create_task(watch_cmd())
    while True:
        log("ring: waiting — Enter to call Donna")
        while SAYS.empty() and TYPED.empty(): await asyncio.sleep(0.2)
        if not TYPED.empty() and TYPED.get_nowait() is HANG_UP: continue   # any line is an Enter; a Hang up left from the last call is not
        seed, opener = context_seed(), PICKUP   # Enter: the user called her; she picks up first
        if not SAYS.empty():
            opener = None
            await asyncio.sleep(0.5)   # let a burst of says land together
            got = [SAYS.get_nowait() for _ in range(SAYS.qsize())]
            for g in got:
                if g[0] == "ask": SAYS.put_nowait(g)   # asked aloud by says() once the session is up
            about = " ".join(" ".join(t for k, _, t in got if k != "ask").split())
            event("call.ring", about=about or " ".join(t for _, _, t in got)); NOW["ringing"] = True
            for k, sid, _ in got:
                if k != "ask": event("task.spoken", id=sid)   # the opener delivers it (asks are put by says() once the session is up)
            if about: seed = f"{CALLING_ABOUT} {about}\n{seed}".strip()
        event("call.answered"); set_state("on_call"); reason = "interrupted"
        try: reason = await phone(seed, opener)
        except Exception as e: log("call failed:", repr(e)); reason = "error"
        finally: event("call.ended", reason=reason); set_state("idle")

async def run():
    states = asyncio.create_task(state_loop())
    try: await main()
    finally: states.cancel()

def start_brain(repo):   # #38: the brain in tmux, so herd.send can wake it (herd.wake) and the user can attach and watch
    import subprocess
    name = herd.tmux_name(); t = f"={name}:"
    tm = lambda *a: subprocess.run(["tmux", *a], capture_output=True, text=True)
    if tm("has-session", "-t", t).returncode == 0: log(f"brain: tmux session {name} is running already"); return
    codex = args.brain_engine == "codex"
    cli = (["codex", "-s", "danger-full-access", "-a", "never", "-c", 'model_reasoning_effort="medium"', *(["-m", args.brain_model] if args.brain_model else [])] if codex else   # #66: full access: herd writes $HIGGS_HOME and hires codex workers (a nested sandbox cannot); ponytail: medium effort, the account default xhigh is too slow for a phone
           ["env", "-u", "ANTHROPIC_API_KEY", "claude", "--settings", os.path.join(HERE, "hooks", "office.json"), *(["--model", args.brain_model] if args.brain_model else [])])   # the claude.ai login, not the low-credit key
    tm("new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", repo, "-e", f"HIGGS_HOME={HIGGS_DIR}", *cli)
    told = False
    for _ in range(90):   # wait for the prompt; a folder Claude Code (or Codex) has not seen asks for trust first, and that answer is the user's
        pane = tm("capture-pane", "-p", "-t", t).stdout
        if "trust" in pane.lower():
            if not told: log(f"brain: {'Codex' if codex else 'Claude Code'} asks whether to trust {repo}; answer it in: tmux attach -t {name}"); told = True
        elif ("›" if codex else "❯") in pane: break
        time.sleep(1)
    else: log(f"brain: no prompt in 90 s; see: tmux attach -t {name}"); return
    herd.wake(f"Read {HERE}/.claude/skills/call/SKILL.md and follow it: you are Donna's brain." + (
        f" You run on Codex in tmux: register with --kind codex, skip the wait loop, hire workers with herd.py; tasks and worker results are typed into this window."
        f" herd.py and bridge.py are in {HERE}: use that path wherever the skill says ~/projects/higgs-hackathon." if codex else ""))
    log(f"brain: started in tmux session {name} ({repo}); watch it with: tmux attach -t {name}")

if args.brain: start_brain(os.path.abspath(os.path.expanduser(args.brain)))
try: asyncio.run(run())
except KeyboardInterrupt: log("hung up (Ctrl-C)")
finally:   # `off` last (Mike's contract), and the office sees it at once
    write_state("off", armed=False)
    try: herd.write_office()
    except Exception: pass
