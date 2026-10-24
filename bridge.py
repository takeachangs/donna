# /// script
# dependencies = ["sounddevice", "websockets>=13"]
# ///
"""Voice bridge: Higgs Realtime on the mic and speaker, a Claude Code session (or `claude -p`) as the brain.

  uv run bridge.py                        # mic + speaker; backend = headless `claude -p` in ./sandbox (or --project DIR)
  uv run bridge.py --backend session      # the /call skill: a Claude Code session answers via ~/.higgs/inbox.jsonl + outbox.jsonl
  uv run bridge.py --backend fake         # 6 s sleep instead of Claude (no Claude credits)
  uv run bridge.py --text "a | b"         # headless: typed turns instead of the mic; exits after the last result is spoken
  uv run bridge.py --ring --backend session   # Donna's phone: no call open; a `say` in ~/.higgs/herd/donna/outbox.jsonl rings,
                                          # Enter calls her; hangs up on "bye", 60 s of silence or Higgs idle timeout
  uv run bridge.py say  ID "text"         # spoken result for delegation ID   (session backend)
  uv run bridge.py note ID "text"         # quiet progress for delegation ID  (session backend)

Delegations land in ~/.higgs/inbox.jsonl, one JSON line each: {"id", "task", "context": "last turns"}.
~/.higgs/context.txt, if present, is sent to the voice at the start of the call (first 4000 chars). If its first line is
`Calling about: <reason>` the voice speaks first and says why it's calling. The delegation layer itself is higgslive.py.
"""
import argparse, asyncio, base64, json, logging, os, queue, re, subprocess, sys, threading, time
import higgslive

RATE = 24000
HIGGS_DIR = os.path.expanduser(os.environ.get("HIGGS_DIR", "~/.higgs"))
INBOX, OUTBOX, CONTEXT = (os.path.join(HIGGS_DIR, f) for f in ("inbox.jsonl", "outbox.jsonl", "context.txt"))
HERD = os.path.join(HIGGS_DIR, "herd"); EVENTS = os.path.join(HERD, "events.jsonl"); DONNA = os.path.join(HERD, "donna")
CALLING_ABOUT = "Calling about:"
if len(sys.argv) > 2 and sys.argv[1] in ("say", "note"):   # the session's reply path
    os.makedirs(HIGGS_DIR, exist_ok=True)
    with open(OUTBOX, "a") as f: f.write(json.dumps({"kind": sys.argv[1], "id": sys.argv[2], "text": " ".join(sys.argv[3:])[:1500], "ts": time.time()}) + "\n")
    sys.exit(0)

ap = argparse.ArgumentParser()
ap.add_argument("--backend", choices=["session", "claude", "codex", "fake"], default="claude",
                help="session: any coding agent (Claude Code, Codex, …) watching ~/.higgs/inbox.jsonl answers via say/note; claude/codex: headless CLI in --project")
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
args = ap.parse_args()
if args.ring:
    if args.text: ap.error("--ring cannot be combined with --text")
    INBOX, OUTBOX = (os.path.join(DONNA, f) for f in ("inbox.jsonl", "outbox.jsonl"))   # Donna's files, not the /call skill's
HERE = os.path.dirname(os.path.abspath(__file__))
SANDBOX = os.path.abspath(os.path.expanduser(args.project)) if args.project else os.path.join(HERE, "sandbox")

PROMPT = """## Role
You're Sam, the user's warm, easygoing voice assistant. No set topic or scenario: the user decides what to talk about and you
follow. Never invent a topic or something you were "supposed to" discuss. Talk like a person: contractions, a little humor,
short turns, react to what they actually said. Vary your wording; no stock lines. Brisk, lively pace, never slow or soothing.

## Delegation policy
Whenever the user wants something made, opened, run, checked, found, looked up or computed, delegate it. Small talk,
opinions and questions you can answer from the conversation itself you handle yourself.

## Backchannel policy
Short acks: "on it", "mm-hm?". If what you heard was garbled or just "yeah"/"hmm", don't invent a topic; ask them to say it
again. Never read code, JSON, file paths or markdown aloud; numbers in words.

## Interruption policy
If the user talks over you, stop. Any task keeps running; pick it up again when its result arrives."""

T0 = time.monotonic()
LOGF = open(os.path.join(HERE, "bridge.log"), "a")
LOGF.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(sys.argv[1:])}\n")
def log(*a):
    line = f"[{time.monotonic()-T0:6.2f}s] " + " ".join(str(x) for x in a)
    print(line, flush=True); LOGF.write(line + "\n"); LOGF.flush()
class _H(logging.Handler):
    def emit(self, r): log(r.getMessage())
logging.getLogger("higgslive").addHandler(_H()); logging.getLogger("higgslive").setLevel(logging.INFO)

SESSION: dict = {}             # the backend Claude Code session id, kept for the length of the call
BACKEND_LOCK = asyncio.Lock()  # one agent: tasks run one at a time, in order
CLAIMED: set = set()           # ring: delegation ids; backend() reads their say/note itself, so the outbox watcher skips them
SAYS: asyncio.Queue = asyncio.Queue()   # ring: texts of unclaimed `say` lines (the agent calling the user)
BYE = re.compile(r"\b(bye|goodbye|that'?s all|talk (to you )?later|hang up)\b")

def summarize_tool(name, inp):
    if inp.get("description"): return str(inp["description"])[:60].lower()
    arg = inp.get("file_path") or inp.get("command") or inp.get("pattern") or inp.get("path") or ""
    arg = os.path.basename(str(arg)) if name in ("Read", "Write", "Edit") else str(arg)[:50]
    verb = {"Read": "reading", "Write": "writing", "Edit": "editing", "Bash": "running", "Glob": "searching for", "Grep": "searching"}.get(name, name.lower())
    return f"{verb} {arg}".strip()

async def backend(did: str, task: str, context: str, progress) -> str:
    """Run the task; await progress(text) per step; return ≤3 spoken sentences: facts, status, next step."""
    if args.backend == "session":
        os.makedirs(os.path.dirname(OUTBOX), exist_ok=True); open(OUTBOX, "a").close()
        with open(INBOX, "a") as f: f.write(json.dumps({"id": did, "task": task, "context": context, **({"from": "voice", "ts": time.time()} if args.ring else {})}) + "\n")
        log(f"  → inbox {did}")
        t0 = time.monotonic()
        with open(OUTBOX) as f:
            f.seek(0, 2)
            while time.monotonic() - t0 < 600:
                line = f.readline()
                if not line: await asyncio.sleep(0.2); continue
                try: msg = json.loads(line)
                except Exception: continue
                if msg.get("id") != did: continue
                if msg["kind"] == "note": await progress(msg["text"])
                else: return msg["text"][:800]
        return "The session did not answer within ten minutes."
    if args.backend == "fake":
        for step in ("looking at the folder", "writing the file", "opening it"):
            await asyncio.sleep(2); await progress(step)
        return "Done. The file is written and open in the browser. Nothing else needed."
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
            p.kill(); return "The backend timed out after two minutes."
        return (result or "The backend returned nothing.")[:800]
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
        p.kill(); return "The backend timed out after two minutes."
    return (result or "The backend returned nothing.")[:800]

def context_seed() -> str:
    return open(CONTEXT).read()[:4000].strip() if os.path.exists(CONTEXT) else ""

def event(ev, **kw):
    try:
        os.makedirs(HERD, exist_ok=True)
        with open(EVENTS, "a") as f: f.write(json.dumps({"ts": time.time(), "ev": ev, "agent": "donna", **kw}) + "\n")
    except OSError as e: log("event write failed:", e)
    log("event", ev, kw or "")

def set_state(s):
    try:
        herd_py = os.path.join(HERE, "herd.py")
        if os.path.exists(herd_py): subprocess.run(["uv", "run", "-q", herd_py, "state", "donna", s], timeout=15)   # herd.py writes the state + its own event
        else:   # ponytail: no herd.py yet, write status.json directly
            p = os.path.join(DONNA, "status.json"); os.makedirs(DONNA, exist_ok=True)
            try: d = json.load(open(p))
            except Exception: d = {}
            d["state"] = s
            with open(p + ".tmp", "w") as f: json.dump(d, f)
            os.replace(p + ".tmp", p); event("agent.state", state=s)
    except Exception as e: log("set_state failed:", repr(e))

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
                if m.get("kind") == "say" and m.get("text") and m.get("id") not in CLAIMED: SAYS.put_nowait(m["text"])
            except Exception: continue

async def call(seed: str) -> str:
    """One session, start to hang-up. Returns why it ended."""
    spk: queue.Queue = queue.Queue(); loop = asyncio.get_running_loop()
    st = {"done": False, "pending": 0, "spoke_result": False, "act": time.monotonic(), "audio": 0.0, "bye": None, "vs": False, "vu": False}
    def end(reason):
        if not st["done"]: st.update(done=True, reason=reason)
    transcript: list[str] = []
    turns = [t.strip() for t in args.text.split("|")] if args.text else []
    sd = None
    if not args.silent or not (args.text or args.wav or args.ring): import sounddevice as sd

    def spk_thread():
        try:
            odev = None
            if args.out:
                odev = next((i for i, d in enumerate(sd.query_devices()) if args.out.lower() in d["name"].lower() and d["max_output_channels"] > 0), None)
                loop.call_soon_threadsafe(log, f"speaker: {sd.query_devices(odev)['name'] if odev is not None else 'no match for ' + args.out + ', using default'}")
            with sd.RawOutputStream(samplerate=RATE, channels=1, dtype="int16", device=odev) as out:
                import math, array
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

    log("connecting…")
    async with higgslive.connect(playback=not args.silent, model=args.model) as conn:
        await conn.session.start(session={"instructions": PROMPT, "delegation": {"type": "client"}, "voice": args.voice,
            **({"input": [{"type": "message", "role": "developer", "content": [{"type": "input_text", "text": seed}]}]} if seed else {})})

        async def run_delegation(did, task):
            st["pending"] += 1
            try:
                if BACKEND_LOCK.locked(): await conn.session.thinking.append(content="queued behind the current task", delegation_id=did)
                async with BACKEND_LOCK:
                    t = time.monotonic(); log(f"backend started for {did}: {task[:90]}")
                    async def progress(text): await conn.session.thinking.append(content=text, delegation_id=did)
                    text = await backend(did, task, "\n".join(transcript[-6:]), progress)
                    log(f"backend done for {did} in {time.monotonic()-t:.1f}s")
                    await conn.session.commentary.append(content=text, delegation_id=did)
            finally: st["pending"] -= 1

        async def typed_turn(text):
            transcript.append("User: " + text); log("USER (typed):", text); await conn.input_text.append(text)

        tasks, stream = [], None
        if args.wav:
            async def play_wav():
                data = open(args.wav, "rb").read()[44:]; step = RATE // 10 * 2
                for i in range(0, len(data), step):
                    await conn.input_audio.append(data[i:i+step]); await asyncio.sleep(0.1)
                log("wav finished")
            tasks.append(asyncio.create_task(play_wav())); log("streaming wav as mic")
        elif not (args.text or args.ring and args.silent):   # ring+silent: headless, no mic
            import array
            meter = {"n": 0, "peak": 0}
            def on_mic(indata, frames, t, status):
                buf = bytes(indata); a = array.array("h", buf)
                asyncio.run_coroutine_threadsafe(conn.input_audio.append(buf), loop)
                meter["peak"] = max(meter["peak"], max(abs(x) for x in a) if a else 0); meter["n"] += 1
                if meter["n"] % 20 == 0:
                    lvl = meter["peak"] / 32768; meter["peak"] = 0
                    loop.call_soon_threadsafe(log, f"mic level {lvl:.3f}" + ("   <-- ZERO: terminal has no microphone permission" if lvl < 0.001 else ""))
            dev = None
            if args.mic:
                dev = next((i for i, d in enumerate(sd.query_devices()) if args.mic.lower() in d["name"].lower() and d["max_input_channels"] > 0), None)
                log(f"mic: {sd.query_devices(dev)['name'] if dev is not None else 'no match for ' + args.mic + ', using default'}")
            stream = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=RATE // 10, callback=on_mic, device=dev); stream.start()
        if args.max_seconds:
            async def deadline(): await asyncio.sleep(args.max_seconds); end("max-seconds"); log("max-seconds reached")
            tasks.append(asyncio.create_task(deadline()))
        if args.ring:
            async def says():   # updates from the work sent off, arriving mid-call
                while True:
                    text = await SAYS.get()
                    await conn.session.commentary.append(content=f"[note] An update just came in from the work you sent off; tell the user in a sentence or two: {text}")
            async def ticker():
                while True:
                    await asyncio.sleep(0.5); now = time.monotonic()
                    if st["bye"] and now - st["bye"] > 8: end("goodbye")   # fallback: no response.done after the goodbye
                    elif now - st["act"] > 60 and not st["pending"] and now - st["audio"] > 2: end("silence")
            tasks += [asyncio.create_task(says()), asyncio.create_task(ticker())]

        async def events():
            async for ev in conn:
                t = ev.type
                if os.environ.get("DEBUG") and t == "raw": log("  ev:", ev.raw_type)
                if t == "session.started":
                    log(f"session ready (backend: {args.backend})")
                    if (first := seed.split("\n", 1)[0]).startswith(CALLING_ABOUT):   # the agent placed the call: the voice speaks first
                        await conn.session.commentary.append(content=f"You placed this call. Open by saying in a few words why you are calling: {first[len(CALLING_ABOUT):].strip()}.")
                    elif turns: await typed_turn(turns.pop(0))
                    elif not args.wav: log("mic live — talk. Ctrl-C to hang up.")
                elif t == "error": log("ERROR", ev.error)
                elif t == "session.closed": log("session closed:", ev.reason); end(ev.reason)
                elif t == "session.input_speech_started":
                    clear_spk(); log("… user speaking (barge-in: playback cleared)"); st["act"] = time.monotonic()
                    if args.ring and not st["vu"]: st["vu"] = True; event("voice.user")
                elif t == "session.input_speech_stopped": st["vu"] = False
                elif t == "session.input_transcript.done":
                    log("USER:", ev.transcript); transcript.append("User: " + ev.transcript); st["act"] = time.monotonic(); st["vu"] = False
                    if args.ring and BYE.search(ev.transcript.lower().replace("’", "'")): st["bye"] = time.monotonic()   # no goodbye prompt: the model answers "bye" itself
                elif t == "session.output_audio.delta":
                    st["audio_bytes"] = st.get("audio_bytes", 0) + len(ev.delta) * 3 // 4; st["audio"] = time.monotonic()
                    if args.ring and not st["vs"]: st["vs"] = True; event("voice.speaking")
                    if not args.silent: spk.put(base64.b64decode(ev.delta))
                elif t == "session.output_transcript.done":
                    secs = st.pop("audio_bytes", 0) / (RATE * 2); words = len(ev.transcript.split())
                    log(f"VOICE ({secs:.1f}s, {words / secs * 60:.0f} wpm):" if secs > 0.5 else "VOICE:", ev.transcript); transcript.append("Sam: " + ev.transcript); st["act"] = time.monotonic()
                elif t == "session.delegation.created":
                    log(f"DELEGATION {ev.delegation.id} @{ev.offset_ms}ms: {ev.delegation.task[:90]}"); st["delegated"] = True
                    CLAIMED.add(ev.delegation.id); tasks.append(asyncio.create_task(run_delegation(ev.delegation.id, ev.delegation.task)))
                elif t == "session.commentary.appended" and ev.delegation_id: st["spoke_result"] = True
                elif t == "response.done" and args.ring:
                    st["vs"] = False
                    if st["bye"]: end("goodbye")
                elif t == "response.done" and args.text and not ev.calls:   # headless pacing: next typed turn, or exit once everything is spoken
                    if turns: await asyncio.sleep(1.5); await typed_turn(turns.pop(0))
                    elif (st["spoke_result"] and not st["pending"]) or not st.get("delegated"):
                        if not st.get("delegated"): log("model answered WITHOUT delegating — nothing to wait for")
                        st["done"] = True
                if st["done"]: return
        ev_task = asyncio.create_task(events())
        try:
            while not st["done"]: await asyncio.sleep(0.2)
            while args.ring and not args.silent and not spk.empty(): await asyncio.sleep(0.1)   # let the goodbye finish playing
            await asyncio.sleep(0.5 if args.silent else 3)
        finally:
            for t in tasks + [ev_task]: t.cancel()
            if stream: stream.stop(); stream.close()
            spk.put(None); log("closed")
    return st.get("reason", "done")

async def main():
    if not args.ring: await call(context_seed()); return
    loop = asyncio.get_running_loop(); enter = asyncio.Event()
    def stdin_thread():
        try:
            while sys.stdin.readline(): loop.call_soon_threadsafe(enter.set)   # "" = EOF (stdin is /dev/null): never an Enter
        except Exception: pass
    threading.Thread(target=stdin_thread, daemon=True).start()
    watcher = asyncio.create_task(watch_outbox())
    while True:
        log("ring: waiting — Enter to call Donna")
        while SAYS.empty() and not enter.is_set(): await asyncio.sleep(0.2)
        seed = ""   # Enter: the voice waits for the user
        if not SAYS.empty():
            await asyncio.sleep(0.5)   # let a burst of says land together
            about = " ".join(" ".join(SAYS.get_nowait() for _ in range(SAYS.qsize())).split())
            event("call.ring", about=about); seed = f"{CALLING_ABOUT} {about}"
        event("call.answered"); set_state("on_call"); reason = "interrupted"
        try: reason = await call(seed)
        except Exception as e: log("call failed:", repr(e)); reason = "error"
        finally: event("call.ended", reason=reason); set_state("idle"); enter.clear()

try: asyncio.run(main())
except KeyboardInterrupt: log("hung up (Ctrl-C)")
