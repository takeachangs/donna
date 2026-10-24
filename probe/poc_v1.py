# /// script
# dependencies = ["sounddevice", "websockets>=13"]
# ///
"""
Delegation POC on Higgs Realtime.

  uv run poc.py                      # mic + speaker, delegate mode (voice keeps talking while Claude Code works)
  uv run poc.py --mode sync          # same, but the tool blocks: voice goes silent until the backend returns
  uv run poc.py --text "question"    # headless: one typed turn instead of the mic, exits after the result is spoken
  uv run poc.py --backend fake       # 6 s sleep instead of `claude -p` (no Claude credits)

The voice model (higgs-realtime) owns the conversation. A `run_task(task)` tool hands work to a backend
(`claude -p`). In delegate mode the tool returns {"status":"started"} at once and the result is injected
later as a user-role text item, mirroring GPT-Live client delegation. Ctrl-C hangs up.

GOTCHA: do not name the tool "delegate" — higgs-realtime treats that name specially (invents a `reason` arg, re-calls,
then says "the delegation service is not configured"). Any other name works.
"""
import argparse, asyncio, base64, json, os, queue, sys, threading, time
import websockets

RATE = 24000
SESSION: dict = {}   # the backend Claude Code session id, kept for the length of the call
BACKEND_LOCK = asyncio.Lock()   # one coding agent: tasks run one at a time, in order
HIGGS_DIR = os.path.expanduser(os.environ.get("HIGGS_DIR", "~/.higgs"))
INBOX, OUTBOX = os.path.join(HIGGS_DIR, "inbox.jsonl"), os.path.join(HIGGS_DIR, "outbox.jsonl")
if len(sys.argv) > 2 and sys.argv[1] in ("say", "note"):   # `poc.py say <id> "text"` / `poc.py note <id> "text"`: the session's reply path
    os.makedirs(HIGGS_DIR, exist_ok=True)
    with open(OUTBOX, "a") as f: f.write(json.dumps({"kind": sys.argv[1], "id": sys.argv[2], "text": " ".join(sys.argv[3:])[:1500]}) + "\n")
    sys.exit(0)

ap = argparse.ArgumentParser()
ap.add_argument("--mode", choices=["delegate", "sync"], default="delegate")
ap.add_argument("--backend", choices=["claude", "fake", "session"], default="claude",
                help="claude: headless Claude Code; session: a Claude Code session running the /call skill answers via ~/.higgs inbox/outbox")
ap.add_argument("--text", help="headless: send this as one typed user turn instead of using the mic")
ap.add_argument("--silent", action="store_true", help="do not play audio")
ap.add_argument("--wav", help="debug: stream this 24 kHz mono 16-bit WAV as the mic, in real time")
ap.add_argument("--max-seconds", type=float, default=0, help="debug: hang up after this many seconds")
ap.add_argument("--voice", default="default", help="realtime voice: default, chloe, eleanor, jake, marcus, nora, oliver")
ap.add_argument("--mic", help="substring of the input device name to use, e.g. AirPods")
ap.add_argument("--out", help="substring of the output device name to use, e.g. Speakers")
ap.add_argument("--project", help="directory the Claude Code backend works in (default: ./sandbox); it loads that project's CLAUDE.md, skills and MCP servers")
ap.add_argument("--ptt", action="store_true", help="push-to-talk: press Enter to start talking, Enter again to send; no server VAD")
ap.add_argument("--gate", type=float, default=0, help="noise gate: mic blocks with peak below this (0-1) are sent as silence; 0 disables")
args = ap.parse_args()
SANDBOX = os.path.abspath(os.path.expanduser(args.project)) if args.project else os.path.join(os.path.dirname(os.path.abspath(__file__)), "sandbox")

COMMON = """## Role
You're Sam, the user's warm, easygoing voice assistant. No set topic or scenario: the user decides what to talk about and you
follow. Never invent a topic or something you were "supposed to" discuss. Talk like a person: contractions, a little humor,
short turns, react to what they actually said. Vary your wording; no stock lines. Brisk, lively pace, never slow or soothing.

## Delegation policy
You cannot create, open, read, run, or look up anything yourself. The run_task tool hands a job to a coding agent on the
user's computer that can do all of that. Whenever the user wants something made, opened, run, checked, found or computed,
call run_task first, then speak. Never say you can't, never ask for confirmation first.
Describe the task in plain English as a complete request (what, where, what the result should be), never as a shell command or code.
Do not guess the result while waiting. Never report an action as done, running, or sent unless you called run_task.
Progress notes about a task may appear as messages starting with "[progress"; keep them to yourself unless the user asks how
it's going. When a message starting with "[result" arrives, that is the backend's answer: bring it up as a natural aside and
give the outcome in your own words.

## Backchannel policy
Short acks: "on it", "mm-hm?". If what you heard was garbled or just "yeah"/"hmm", don't invent a topic; ask them to say it
again. Never read code, JSON, file paths or markdown aloud; numbers in words.

## Interruption policy
If the user talks over you, stop. Any task keeps running; pick it up again when its result arrives."""
MODE = {
 "delegate": """run_task returns {"status":"started"} immediately. Right after it returns, say in one short sentence that you've handed it off, then ask what else you can help with while it runs. Keep the conversation going on whatever the user brings up; the result will arrive on its own and you bring it up when it does.""",
 "sync": """run_task returns the final answer in its result. Speak it in at most three sentences. Do not call run_task again for the same question.""",
}
INSTRUCTIONS = COMMON + "\n" + MODE[args.mode]

TOOLS = [{"type": "function", "name": "run_task", "description": "Does things on the user's computer through a coding agent: "
          "create or edit files, open pages or files in the browser, run commands, read code, check git, look things up, calculate. "
          "Use it for ANY request to make, open, run, check, find or compute something. The task is a plain-English request, not a command.",
          "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]}}]

T0 = time.monotonic()
LOG = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "poc.log"), "a")
LOG.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(sys.argv[1:])}\n")
def log(*a):
    line = f"[{time.monotonic()-T0:6.2f}s] " + " ".join(str(x) for x in a)
    print(line, flush=True); LOG.write(line + "\n"); LOG.flush()

def summarize_tool(name, inp):
    """One short progress line per backend tool call."""
    if inp.get("description"): return str(inp["description"])[:60].lower()   # Bash calls carry Claude's own one-line description
    arg = inp.get("file_path") or inp.get("command") or inp.get("pattern") or inp.get("path") or ""
    arg = os.path.basename(str(arg)) if name in ("Read", "Write", "Edit") else str(arg)[:50]
    verb = {"Read": "reading", "Write": "writing", "Edit": "editing", "Bash": "running", "Glob": "searching for", "Grep": "searching"}.get(name, name.lower())
    return f"{verb} {arg}".strip()

async def backend(task: str, context: str, progress) -> str:
    """Run the task; call progress(text) for each step; return 'facts, status, next step' prose."""
    if args.backend == "session":
        os.makedirs(HIGGS_DIR, exist_ok=True); open(OUTBOX, "a").close()
        tid = f"task_{int(time.time()*1000) % 10**8}"
        with open(INBOX, "a") as f: f.write(json.dumps({"id": tid, "task": task, "context": context}) + "\n")
        log(f"  → inbox {tid}")
        t0 = time.monotonic()
        with open(OUTBOX) as f:
            f.seek(0, 2)   # only lines written after this task
            while time.monotonic() - t0 < 600:
                line = f.readline()
                if not line: await asyncio.sleep(0.2); continue
                try: msg = json.loads(line)
                except Exception: continue
                if msg.get("id") != tid: continue
                if msg["kind"] == "note": await progress(msg["text"])
                else: return msg["text"][:800]
        return "The session did not answer within ten minutes."
    if args.backend == "fake":
        for i, step in enumerate(("looking at the folder", "writing the file", "opening it")):
            await asyncio.sleep(2); await progress(step)
        return "Done. The file is written and open in the browser. Nothing else needed."
    prompt = f"""## Voice conversation context
{context or '(none)'}

## Task
{task}

## Return the result
Do the task in the current directory. Then reply in at most three plain sentences for a voice assistant to speak: facts, status, next step. No code, no markdown, no file paths unless essential."""
    resume = ["--resume", SESSION["id"]] if SESSION.get("id") else []   # one Claude Code session per call: task N remembers task N-1
    p = await asyncio.create_subprocess_exec("claude", "-p", prompt, "--output-format", "stream-json", "--verbose", *resume,
        "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(ls:*),Bash(find:*),Bash(wc:*),Bash(git status:*),Bash(git log:*),Bash(git diff:*),Bash(du:*),Bash(open:*),Bash(mkdir:*),Bash(cat:*)",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, cwd=SANDBOX)
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

async def main():
    mic: asyncio.Queue[bytes] = asyncio.Queue(); spk: queue.Queue = queue.Queue(); loop = asyncio.get_running_loop()
    st = {"in_flight": False, "user_speaking": False, "silent_since": None, "done": False}
    results: asyncio.Queue[tuple[str, str, bool]] = asyncio.Queue()   # (call_id, text, speak?)
    transcript: list[str] = []   # last turns, "User: …" / "Sam: …", fed to the backend as context

    sd = None
    if not args.silent or not args.text:
        import sounddevice as sd
    def spk_thread():
        try:
            odev = None
            if args.out:
                odev = next((i for i, d in enumerate(sd.query_devices()) if args.out.lower() in d["name"].lower() and d["max_output_channels"] > 0), None)
                loop.call_soon_threadsafe(log, f"speaker: {sd.query_devices(odev)['name'] if odev is not None else 'no match for ' + args.out + ', using default'}")
            with sd.RawOutputStream(samplerate=RATE, channels=1, dtype="int16", device=odev) as out:
                import math, array
                beep = array.array("h", (int(6000 * math.sin(2 * math.pi * 880 * i / RATE)) for i in range(RATE // 5)))
                out.write(beep.tobytes()); loop.call_soon_threadsafe(log, "speaker: played a short beep — if you did not hear it, output is going to the wrong device")
                while (chunk := spk.get()) is not None:
                    out.write(chunk); st["spk_at"] = time.monotonic()
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
    ws = await websockets.connect("wss://api.boson.ai/v1/realtime?model=higgs-realtime",
        additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None, open_timeout=20)
    send = lambda ev: ws.send(json.dumps(ev))
    await send({"type": "session.update", "session": {"type": "realtime", "model": "higgs-realtime",
        "instructions": INSTRUCTIONS, "tools": TOOLS, "tool_choice": json.loads(os.environ["TOOL_CHOICE"]) if os.environ.get("TOOL_CHOICE", "").startswith("{") else os.environ.get("TOOL_CHOICE", "auto"),
        "audio": {"input": {"format": {"type": "audio/pcm", "rate": RATE}, "turn_detection": None if args.ptt else {"type": "server_vad", "threshold": 0.65, "silence_duration_ms": 700, "min_speech_duration": 0.3, "prefix_padding_ms": 300}, "noise_reduction": {"type": "near_field"},
                            "transcription": {"model": "higgs-stt-3.1"}},
                  "output": {"format": {"type": "audio/pcm", "rate": RATE}, "voice": args.voice}},
        "temperature": 0.5}})

    async def pump_mic():
        while True:
            buf = await mic.get()
            if args.ptt and not st.get("talking"): continue
            await send({"type": "input_audio_buffer.append", "audio": base64.b64encode(buf).decode()})

    def ptt_toggle():
        sys.stdin.readline()
        if not st.get("talking"):
            st.update(talking=True, user_speaking=True, guarded=False, turn_delegated=False); clear_spk()
            if st["in_flight"]: asyncio.ensure_future(send({"type": "response.cancel"}))
            log("● talking — press Enter to send")
        else:
            st.update(talking=False, user_speaking=False)
            async def commit():
                await send({"type": "input_audio_buffer.commit"}); await send({"type": "response.create"})
            asyncio.ensure_future(commit()); log("○ sent")

    async def inject_results():
        # ponytail: a result waits until nothing is in flight and the user is quiet; no priority, no coalescing
        while True:
            call_id, text, speak = await results.get()
            if not speak:   # thinking channel: add context, request no reply
                await send({"type": "conversation.item.create", "item": {"type": "message", "role": "user",
                    "content": [{"type": "input_text", "text": f"[progress on the task you sent off]: {text}"}]}})
                log(f"  ~ note: {text}"); continue
            while True:   # wait for: no generation in flight, user quiet, speaker drained, then a one-second beat
                if not st["in_flight"] and not st["user_speaking"] and spk.empty() and time.monotonic() - st.get("spk_at", 0) > 1.0:
                    break
                await asyncio.sleep(0.1)
            st["added"] = asyncio.Event()
            await send({"type": "conversation.item.create", "item": {"type": "message", "role": "user",
                "content": [{"type": "input_text", "text": f"[result] {text}"}]}})
            try: await asyncio.wait_for(st["added"].wait(), 3)   # let the server add the item before asking for a reply
            except asyncio.TimeoutError: log("warning: no item.added ack for the result")
            await send({"type": "response.create"}); st["injected"] = call_id
            log(f"→ injected result for {call_id} ({len(text)} chars)")

    async def run_delegation(call_id, task):
        st["pending"] = st.get("pending", 0) + 1
        try: await _run_delegation(call_id, task)
        finally: st["pending"] -= 1

    async def _run_delegation(call_id, task):
        if BACKEND_LOCK.locked(): await results.put((call_id, "queued behind the current task", False))
        async with BACKEND_LOCK:
          t = time.monotonic(); log(f"backend started for {call_id}: {task[:90]}")
          async def progress(text): await results.put((call_id, text, False))
          async def still_working():   # ponytail: one spoken "taking a while" at 25 s, per OpenAI's "say something when a delay matters"
              await asyncio.sleep(25); await results.put((call_id, "still in progress, taking longer than usual; tell the user in a few words", True))
          sw = asyncio.create_task(still_working())
          text = await backend(task, "\n".join(transcript[-6:]), progress); sw.cancel()
          log(f"backend done for {call_id} in {time.monotonic()-t:.1f}s"); await results.put((call_id, text, True))

    async def handle(ev):
        t = ev["type"]
        if os.environ.get("DEBUG") and "delta" not in t: log("  ev:", t)
        if t == "error": log("ERROR", ev["error"]); return
        if t == "session.created": log("session ready", "(mode:", args.mode + ", backend:", args.backend + ")"); return
        if t == "response.created": st["in_flight"] = True
        if t == "conversation.item.added" and st.get("added"): st["added"].set()
        if t == "input_audio_buffer.speech_started":
            st["user_speaking"] = True; st["guarded"] = False; st["turn_delegated"] = False
            clear_spk(); log("… user speaking (barge-in: playback cleared)")
        if t == "input_audio_buffer.speech_stopped": st["user_speaking"] = False
        if t == "conversation.item.input_audio_transcription.completed":
            log("USER:", ev.get("transcript")); st["last_user"] = ev.get("transcript") or ""; transcript.append("User: " + st["last_user"])
        if t == "response.output_audio.delta":
            st["audio_bytes"] = st.get("audio_bytes", 0) + len(ev["delta"]) * 3 // 4
            if not args.silent: spk.put(base64.b64decode(ev["delta"]))
        if t == "response.output_audio_transcript.done":
            secs = st.pop("audio_bytes", 0) / (RATE * 2); words = len(ev["transcript"].split())
            log(f"VOICE ({secs:.1f}s, {words / secs * 60:.0f} wpm):" if secs > 0.5 else "VOICE:", ev["transcript"]); st["last_voice"] = ev["transcript"]
            transcript.append("Sam: " + ev["transcript"])
        if t == "response.done":
            st["in_flight"] = False; r = ev["response"]
            calls = [o for o in r.get("output", []) if o.get("type") == "function_call"]
            v = st.pop("last_voice", "") or ""
            import re
            vl = v.lower()
            claim = bool(re.search(r"\b(sen[dt]\w*\s+(that|it|this)\s+off|on it\b|i'?m\s+(creating|making|building|writing|checking|looking|running|opening|sending)|should be running|backend result)", vl))
            offer = bool(re.search(r"\b(i'?ll\s+(creat|mak|build|writ|check|look|run|open|get|find|count|send)|let me\s+(creat|mak|check|look|run|open|see)|"
                                   r"i (can'?t|cannot|am not able to|'m not able to)\b[^.]{0,60}\b(directly|files?|code|computer|browser|access|run|open|create|make)|copy and paste|here'?s (a|the) (simple )?(example|code|html))", vl))
            asked = bool(re.search(r"\b(make|create|build|write|open|run|check|find|count|look ?up|search|calculate|show me|how many|what'?s in|list|generate|set up|fix|install|delete|rename|convert|download)\b", st.get("last_user", "").lower()))
            fake = claim or (asked and offer)   # a present-tense claim is always fake without a call; an offer/refusal only counts after a real request
            if not calls and fake and not st.get("guarded") and not st.get("turn_delegated"):
                st["guarded"] = True  # ponytail: one forced retry per user turn, no loop
                log("GUARD: " + ("reply claimed a task" if fake else "user asked for something") + " but run_task was not called — nudging")
                await send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text",
                    "text": "(system) No task was sent: you did not call run_task. Call run_task now for what the user asked, then say you've sent it off."}]}})
                await send({"type": "response.create"}); return  # ponytail: tool_choice required/named both break the server; the nudge alone works
            if calls: st["turn_delegated"] = True
            if args.wav and st.get("wav_done") and not calls: st["done"] = True
            if args.text and not calls:
                if turns: await asyncio.sleep(1.5); await typed_turn(turns.pop(0))
                elif (st.get("injected") and not st.get("pending")) or not st.get("delegated"):
                    if not st.get("delegated"): log("model answered WITHOUT delegating — nothing to wait for")
                    st["done"] = True
            for c in calls:
                task = json.loads(c["arguments"]).get("task", ""); cid = c["call_id"]
                log(f"DELEGATION {cid}: {task[:90]}"); st["delegated"] = True
                if args.mode == "delegate":
                    await send({"type": "conversation.item.create", "item": {"type": "function_call_output",
                        "call_id": cid, "output": json.dumps({"status": "started", "id": cid})}})
                    await send({"type": "response.create"})
                    asyncio.create_task(run_delegation(cid, task))
                else:
                    t1 = time.monotonic(); text = await backend(task)
                    log(f"sync: voice was silent {time.monotonic()-t1:.1f}s")
                    await send({"type": "conversation.item.create", "item": {"type": "function_call_output",
                        "call_id": cid, "output": text}})
                    await send({"type": "response.create"}); st["injected"] = cid

    tasks = [asyncio.create_task(inject_results())]
    turns = [t.strip() for t in args.text.split("|")] if args.text else []
    async def typed_turn(text):
        st["guarded"] = False; st["turn_delegated"] = False; st["last_user"] = text; transcript.append("User: " + text)
        await send({"type": "conversation.item.create", "item": {"type": "message", "role": "user",
            "content": [{"type": "input_text", "text": text}]}})
        await send({"type": "response.create"}); log("USER (typed):", text)
    if turns: await typed_turn(turns.pop(0))
    elif args.wav:
        async def play_wav():
            data = open(args.wav, "rb").read()[44:]; step = RATE // 10 * 2
            for i in range(0, len(data), step):
                await mic.put(data[i:i+step]); await asyncio.sleep(0.1)
            log("wav finished; waiting for the reply"); st["wav_done"] = True
        tasks += [asyncio.create_task(pump_mic()), asyncio.create_task(play_wav())]; log("streaming wav as mic")
    else:
        import array, math
        meter = {"n": 0, "peak": 0}
        def on_mic(indata, frames, t, status):
            buf = bytes(indata); a = array.array("h", buf); pk = (max(abs(x) for x in a) if a else 0) / 32768
            if args.gate and pk >= args.gate: meter["open_until"] = meter["n"] + 8          # keep the gate open ~800 ms after loud audio
            if args.gate and meter["n"] > meter.get("open_until", -1): buf = b"\x00" * len(buf)  # below the gate: send silence
            loop.call_soon_threadsafe(mic.put_nowait, buf)
            meter["peak"] = max(meter["peak"], pk * 32768); meter["n"] += 1
            if meter["n"] % 20 == 0:  # every 2 s
                lvl = meter["peak"] / 32768; meter["peak"] = 0
                loop.call_soon_threadsafe(log, f"mic level {lvl:.3f}" + ("   <-- ZERO: terminal has no microphone permission" if lvl < 0.001 else ""))
        dev = None
        if args.mic:
            dev = next((i for i, d in enumerate(sd.query_devices()) if args.mic.lower() in d["name"].lower() and d["max_input_channels"] > 0), None)
            log(f"mic: {sd.query_devices(dev)['name'] if dev is not None else 'no match for ' + args.mic + ', using default'}")
        stream = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=RATE // 10, callback=on_mic, device=dev)
        stream.start(); tasks.append(asyncio.create_task(pump_mic()))
        if args.ptt: loop.add_reader(sys.stdin, ptt_toggle); log("push-to-talk: press Enter to start talking, Enter again to send. Ctrl-C to hang up.")
        else: log("mic live — talk. Ctrl-C to hang up.")
    if args.max_seconds:
        async def deadline(): await asyncio.sleep(args.max_seconds); st["done"] = True; log("max-seconds reached")
        tasks.append(asyncio.create_task(deadline()))
    try:
        while not st["done"]:
            try: msg = await asyncio.wait_for(ws.recv(), timeout=1)
            except asyncio.TimeoutError: continue
            await handle(json.loads(msg))
            if st["done"]:
                await asyncio.sleep(0.5 if args.silent else 3); break
    finally:
        for t in tasks: t.cancel()
        spk.put(None); await ws.close(); log("closed")

try: asyncio.run(main())
except KeyboardInterrupt: log("hung up (Ctrl-C)")
except Exception as e: log("CRASH:", repr(e)); raise
