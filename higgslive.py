# /// script
# dependencies = ["websockets>=13"]
# ///
"""GPT-Live-style client delegation on Higgs Realtime, in one file.

    import higgslive
    async with higgslive.connect() as conn:                       # BOSON_API_KEY from the environment
        await conn.session.start(session={
            "instructions": PROMPT,                                # role, backchannel, interruption, delegation *policy*
            "delegation": {"type": "client"},                      # turns delegation on; the mechanics prompt is added here
            "input": [{"type": "message", "role": "developer",     # optional seed, folded into the instructions
                       "content": [{"type": "input_text", "text": "Calling about: ..."}]}],
            "voice": "nora",
        })
        async for ev in conn:
            if ev.type == "session.delegation.created":            # the voice handed work off; it keeps talking
                did, task = ev.delegation.id, ev.delegation.task   # Higgs gives the task text; GPT-Live makes you rebuild it
            elif ev.type == "session.output_audio.delta":
                play(base64.b64decode(ev.delta))
        await conn.input_audio.append(pcm16_24k_bytes)
        await conn.session.thinking.append(content="reading the config", delegation_id=did)   # silent: kept here for task_status
        await conn.session.commentary.append(content="Done, it's open.", delegation_id=did)   # spoken, when the voice is free
        await conn.session.instructions.append(content="The user is now on the pricing page.")

How it maps: the voice model calls a function tool; this layer leaves the call OPEN (Higgs tool calls are asynchronous: the
conversation continues with the output outstanding), requests one response so the model acknowledges, and emits
`session.delegation.created`. Thinking appends never reach Higgs (as conversation items the model answered them instead of
the user); the layer keeps the latest one per delegation for `task_status`. The first commentary append for a delegation waits until the voice is idle, the user is quiet and playback has
drained, then returns the real `function_call_output` plus a one-line cue and requests one response. Instructions appends re-send session.update.
"""
import asyncio, base64, json, logging, os, re, time
from pathlib import Path
from types import SimpleNamespace
import websockets

log = logging.getLogger("higgslive")
URL = "wss://api.boson.ai/v1/realtime?model="
TOOL = "delegate_task"   # NOT "delegate": the server reserves that name for its own server-side tool (returns executor:"server", adds a `reason` arg; "delegation service not configured")
TOOL_DEF = {"type": "function", "name": TOOL, "description": "Hands a job to an agent on the user's computer that can "
            "create or edit files, open pages or files in the browser, run commands, read code, check git, look things up, calculate. "
            "Use it for ANY request to make, add, change, design, open, run, check, find or compute something, including what is in a "
            "file, folder or directory. The task is a plain-English request, not a command.",
            "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]}}
STATUS = "task_status"   # answered at once by this layer from the herd files; never left open
STATUS_DEF = {"type": "function", "name": STATUS, "description": f"How the tasks you sent with {TOOL} are going: which are running, "
              "for how long, latest progress, which finished. Only for tasks.", "parameters": {"type": "object", "properties": {}}}   # naming files/folders here pulled "what's in my directory" to this tool (2/6 runs)
MECHANICS = f"""## Delegation mechanics
Rule one: when the user asks for anything to be made, opened, run, checked, found or computed, call {TOOL} immediately in that
same turn. Never say you can't do it yourself, never offer to delegate, never ask whether to proceed: the user already asked.
A request to add, change, design, plan, style or improve something on a page or file is work too: call {TOOL} with your best
reading of it. If a detail is missing, pick a sensible default, say which, and let the user correct it; never interview the user
before calling. A question about what is in a file, folder or directory, or on the computer, is work too: call {TOOL}.
After the call, one short sentence that it's underway.
Reply to what the user just said. Mention a running task only if they ask or when its result arrives.
{TOOL} hands the job to an agent on the user's computer. Describe the task in plain English as a complete request (what, where,
what the result should be), never as a shell command or code. It runs in the background; its result arrives later as the tool's
output, often several turns after the call. Never guess or report the result before it arrives; when it does, bring it up as a
natural aside and give the outcome in your own words. Never report an action as done, running, or sent unless you called {TOOL}.
When the user asks how it's going, what's happening or whether something is done, call {STATUS} and answer from its output; while a
task is running, even a casual "how's it going" means the task. {STATUS} is only for how a task you sent is going; if it can't
answer what they asked, never say you're checking the status. Never claim progress or results you did not get from a tool."""
NUDGE = f"(system) No task was sent: you did not call {TOOL}. Call {TOOL} now for what the user asked, then say you've sent it off."
RESULT_CUE = "[the result above just arrived; tell the user now in one or two sentences]"   # user-role, after the output: without it the model answered an earlier "still working" note instead (Oct 24 call)
STILL_WORKING_AT = 25   # seconds before one spoken "taking longer than usual", per GPT-Live's "say something when a delay matters"
CLAIM = re.compile(r"\b(sen[dt]\w*\s+(that|it|this)\s+off|hand(ing|ed)\b[^.]{0,20}\boff|on it\b|i'?m\s+(creating|making|building|writing|checking|looking|running|opening|sending|whipping|drafting|putting|setting|sketching)|should be running|backend result)")
OFFER = re.compile(r"\b(i'?ll\s+(creat|mak|build|writ|check|look|run|open|get|find|count|send|add|chang|design|plan|styl|improv|updat)|let me\s+(creat|mak|check|look|run|open|see)|"
                   r"i (can'?t|cannot|am not able to|'m not able to)\b[^.]{0,60}\b(directly|files?|code|computer|browser|access|run|open|create|make)|copy and paste|here'?s (a|the) (simple )?(example|code|html)|"
                   r"shall i (set|get|start) (that|it|this)|(want|like) me to (delegate|hand|send|set|go ahead)|i (can|could) delegate|"
                   r"(i'?ll|i (can|could)|let me)\s+(whip|draft|put (\w+ )?together|set (\w+ )?up|sketch))")   # asking permission instead of calling; offering to draft (Oct 24 calls)
PATH = re.compile(r"(?:~|\.{1,2})?/?(?:[\w.-]+/)+([\w.-]+)")   # a/b/c.txt → c.txt: no paths in speech


def _for(secs: float) -> str:
    m = round(secs / 60)
    return "a few seconds" if secs < 45 else f"{m} minute{'s' * (m != 1)}" if m < 90 else f"{round(secs / 3600)} hours"


def status_summary(since: float, sent=(), now: float | None = None) -> str:
    """One spoken paragraph from $HIGGS_HOME/herd (status.json per agent + events.jsonl): who works on what and for how long,
    who is idle, what finished since `since` (epoch). sent: (task, started_epoch, finished[, latest_note]) for this call's own delegations."""
    now, herd = now or time.time(), Path(os.environ.get("HIGGS_HOME") or Path.home() / ".higgs") / "herd"
    evs = [json.loads(l) for l in (herd / "events.jsonl").read_text().splitlines() if l.strip()] if (herd / "events.jsonl").exists() else []
    sent_at = {e.get("id"): e for e in evs if e.get("ev") == "task.sent"}
    last = {e["agent"]: e for e in evs if e.get("ev") in ("task.note", "task.done")}
    out, idle = [], []
    for f in sorted(herd.glob("*/status.json")):
        name, st = f.parent.name, json.loads(f.read_text())
        if st.get("state") == "dead": continue
        if st.get("state") != "working": idle.append(name); continue
        s = f"{name} has been working on {st.get('task') or 'a task'} for {_for(now - sent_at.get(st.get('task_id'), {}).get('ts', st.get('started') or now))}"
        e = last.get(name)
        out.append(s + (f", latest note: {e['text']}" if e and e["ev"] == "task.note" and e.get("id") == st.get("task_id") else "") + ".")
    if idle: out.append(f"{', '.join(idle)} {'is' if len(idle) == 1 else 'are'} idle.")
    for e in evs:
        if e.get("ev") == "task.done" and e.get("ts", 0) >= since:
            out.append(f"{e['agent']} finished {sent_at.get(e.get('id'), {}).get('task') or 'a task'}: {e.get('text', '')}")
    for task, t, done, *note in sent:
        out.append(f"The task sent on this call, {task}, " + ("is finished." if done else f"has been running for {_for(now - t)}"
                   + (f", latest note: {note[0]}" if note and note[0] else "") + "."))
    return PATH.sub(r"\1", " ".join(out)) or "No agents are running and nothing has finished since the call started."


ASKED = re.compile(r"\b(make|create|build|write|open|run|check|find|count|look ?up|search|calculate|show me|how many|what'?s in|list|generate|set up|fix|install|delete|rename|convert|download|"
                   r"add|change|design|plan|style|improve|update (the|it|that|this|my)|tell (them|it|someone)|have (them|someone))\b")   # not bare "update"/"have it": "any update?", "do you have it?" ask about a running task


def _ev(d):
    """dict → attribute access, recursively (ev.delegation.id)."""
    return SimpleNamespace(**{k: _ev(v) if isinstance(v, dict) else v for k, v in d.items()}) if isinstance(d, dict) else d


def _msg(text: str) -> dict: return {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}


class _Channel:
    def __init__(self, fn): self.append = fn


class Conn:
    def __init__(self, ws, rate, playback=True, model="higgs-realtime"):
        self._ws, self._rate, self._playback, self._model = ws, rate, playback, model
        self._out: asyncio.Queue = asyncio.Queue()        # translated events for the consumer
        self._spoken: asyncio.Queue = asyncio.Queue()     # (text, delegation_id[, note_for]) waiting for a quiet moment
        self._st = dict(in_flight=False, user_speaking=False, spk_until=0.0, guarded=False, turn_delegated=False, last_user="", last_voice="", added=None)
        self._pending: set[str] = set()                   # delegations with no commentary yet
        self._arrived: set[str] = set()                   # delegations whose result came in (queued or spoken): their "still working" note is stale
        self._open: set[str] = set()                      # function calls whose output we have not returned yet
        self._notes: dict = {}                            # delegation id → its latest progress note, for task_status only
        self._sent: dict = {}                             # delegation id → (task, epoch) for task_status
        self._instructions = ""
        self._t0 = time.monotonic()
        self._tasks: list[asyncio.Task] = []
        self.delegation = False
        self.session = SimpleNamespace(start=self._start, commentary=_Channel(self._commentary), thinking=_Channel(self._thinking),
                                       instructions=_Channel(self._instructions_append))
        self.input_audio = _Channel(self._audio)
        self.input_text = _Channel(self._text)             # a typed user turn (not in GPT-Live; handy for headless tests)

    async def _send(self, ev): await self._ws.send(json.dumps(ev))

    # ---- session.start -------------------------------------------------------------------------------------------
    async def _start(self, session: dict):
        self.delegation = (session.get("delegation") or {}).get("type") == "client"
        seed = "\n".join(c["text"] for m in session.get("input", []) for c in m.get("content", []) if c.get("type") == "input_text")
        self._instructions = session.get("instructions", "")
        if self.delegation: self._instructions += "\n\n" + MECHANICS
        if seed: self._instructions += "\n\n## Context for this call\n" + seed.strip()[:4000]   # ponytail: no developer role on Higgs, so the seed rides in the prompt
        fmt = {"type": "audio/pcm", "rate": self._rate}
        await self._send({"type": "session.update", "session": {"type": "realtime", "model": self._model,
            "instructions": self._instructions, "tools": ([TOOL_DEF, STATUS_DEF] if self.delegation else []) + session.get("tools", []), "tool_choice": "auto",   # e.g. {"type": "web_search"}   # required/named break the server
            "audio": {"input": {"format": fmt, "noise_reduction": {"type": "near_field"}, "transcription": {"model": "higgs-stt-3.1"},
                                "turn_detection": session.get("turn_detection", {"type": "server_vad"})},   # server defaults (threshold 0.85 as of Oct 23) = the baseline; tune from there
                      "output": {"format": fmt, "voice": session.get("voice", "default")}},
            "temperature": session.get("temperature", 0.5)}})
        self._tasks = [asyncio.create_task(self._pump()), asyncio.create_task(self._speak_loop())]

    # ---- the three return channels + inputs ------------------------------------------------------------------------
    async def _commentary(self, content: str, delegation_id: str | None = None):
        self._arrived.add(delegation_id)
        await self._spoken.put((content[:1500], delegation_id))

    async def _thinking(self, content: str, delegation_id: str | None = None):
        # client-side only: as user-role items the model answered the note instead of the user ("Hello." → "Still working on that index.html"), Oct 24 call
        self._notes[delegation_id] = content[:1500]
        log.info("  ~ note: %s", content)

    async def _instructions_append(self, content: str, delegation_id: str | None = None):
        self._instructions += "\n" + content
        await self._send({"type": "session.update", "session": {"type": "realtime", "instructions": self._instructions}})   # per-response overrides break; session-level works

    async def _audio(self, pcm: bytes):
        await self._send({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm).decode()})

    async def _text(self, content: str):
        self._st.update(guarded=False, turn_delegated=False, last_user=content)
        await self._item(content); await self._send({"type": "response.create"})

    async def _item(self, text: str):
        await self._send({"type": "conversation.item.create", "item": _msg(text)})

    async def _speak_loop(self):
        # ponytail: one result at a time, oldest first; no priority, no coalescing
        while True:
            text, did, *about = await self._spoken.get()   # about: the delegation a "still working" note is for
            st = self._st
            while st["in_flight"] or st["user_speaking"] or time.monotonic() < st["spk_until"] + 1.0:   # voice idle, user quiet, playback drained + a beat
                await asyncio.sleep(0.1)
            if about and about[0] in self._arrived: continue   # its result came in while the note waited: the result wins (Oct 24 call)
            if did in self._open:   # the native path: the call stayed open all this time; this is its real output (confirmed with Boson, Oct 23)
                self._open.discard(did)
                items = [{"type": "function_call_output", "call_id": did, "output": text}, _msg(RESULT_CUE)]
            else:                   # no open call (opener, "still working" note, a second update for the same task): plain text item
                items = [_msg(text)]
            for item in items:
                st["added"] = asyncio.Event()
                await self._send({"type": "conversation.item.create", "item": item})
                try: await asyncio.wait_for(st["added"].wait(), 3)   # the server must add each item before we ask for the reply, or it answers without it
                except asyncio.TimeoutError: log.warning("no item.added ack before response.create")
            await self._send({"type": "response.create"})
            if did: self._pending.discard(did)
            log.info("→ commentary %s (%d chars)", did or "(no delegation)", len(text))
            self._out.put_nowait(_ev({"type": "session.commentary.appended", "delegation_id": did}))

    async def _still_working(self, did: str):
        await asyncio.sleep(STILL_WORKING_AT)
        if did in self._pending: await self._spoken.put(("[note] The task you handed off is still in progress and taking longer than usual; tell the user in a few words.", None, did))

    # ---- event translation -----------------------------------------------------------------------------------------
    def _emit(self, type_: str, **kw): self._out.put_nowait(_ev({"type": type_, **kw}))

    async def _pump(self):
        try:
            async for raw in self._ws:
                await self._handle(json.loads(raw))
        except websockets.ConnectionClosed as e:
            self._emit("session.closed", reason=f"connection closed ({e.code})")
        except Exception as e:
            self._emit("error", error={"message": repr(e)})

    async def _handle(self, ev: dict):
        t, st = ev["type"], self._st
        if t == "session.created": self._emit("session.started"); return   # the first session.update is not acknowledged; the socket is ordered, so it applies before any turn
        if t == "error": self._emit("error", error=ev["error"]); return
        if t in ("session.idle_timeout", "session.max_duration_reached"): self._emit("session.closed", reason=t); return
        if t == "conversation.item.added" and st["added"]: st["added"].set()
        if t == "response.created": st["in_flight"] = True
        if t == "input_audio_buffer.speech_started":
            st.update(user_speaking=True, guarded=False, turn_delegated=False, spk_until=0.0)   # barge-in: the server stops the response; playback is the client's to clear
            self._emit("session.input_speech_started")
        if t == "input_audio_buffer.speech_stopped": st["user_speaking"] = False; self._emit("session.input_speech_stopped")
        if t == "conversation.item.input_audio_transcription.completed":
            st["last_user"] = ev.get("transcript") or ""; self._emit("session.input_transcript.done", transcript=st["last_user"])
        if t == "response.output_audio.delta":
            if self._playback:   # ponytail: playback end estimated from bytes; add a client hook if it drifts
                now = time.monotonic(); st["spk_until"] = max(st["spk_until"], now) + len(ev["delta"]) * 3 // 4 / (self._rate * 2)
            self._emit("session.output_audio.delta", delta=ev["delta"])
        if t == "response.output_audio_transcript.delta": self._emit("session.output_transcript.delta", delta=ev["delta"])
        if t == "response.output_audio_transcript.done":
            st["last_voice"] = ev["transcript"]; self._emit("session.output_transcript.done", transcript=ev["transcript"])
        if t == "response.done":
            st["in_flight"] = False
            calls = [o for o in ev["response"].get("output", []) if o.get("type") == "function_call" and o.get("name") == TOOL and o.get("executor") != "server"][:1]   # server-side tools (web_search, Oct 23) need no output from us. [:1]: 1.0 fires 2-3 near-duplicate calls for one request (9/12, probe/r15/A-tools.md); extras left open cause no error
            status = [o for o in ev["response"].get("output", []) if o.get("type") == "function_call" and o.get("name") == STATUS and o.get("executor") != "server"][:1]
            self._sent.update({c["call_id"]: (json.loads(c["arguments"]).get("task", ""), time.time()) for c in calls})   # before the status answer: a status call in
            self._open.update(c["call_id"] for c in calls)   # the same response must see this task running, or it reads "idle" and says "done"
            for c in status:   # synchronous: answered now, never enters _pending/_open
                text = status_summary(self._t0 - time.monotonic() + time.time(), [(t, ts, d not in self._open, self._notes.get(d)) for d, (t, ts) in self._sent.items()])
                await self._send({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": c["call_id"], "output": text}})
                log.info("%s → %s", STATUS, text)
            if status and not calls:
                st["guarded"] = True; await self._send({"type": "response.create"})   # same socket, so the output is added before the reply is made
                self._emit("response.done", calls=1, pending=len(self._pending)); return
            if self.delegation and not calls and self._fake_claim() and not st["guarded"] and not st["turn_delegated"] \
                    and (not self._pending or ASKED.search(st["last_user"].lower())):   # a task is running: "on it" to "are you done?" is no fake claim (Oct 24 call)
                st["guarded"] = True   # ponytail: one forced retry per user turn, no loop
                log.info("GUARD: reply claimed or offered a task without calling %s — nudging", TOOL)
                await self._item(NUDGE); await self._send({"type": "response.create"}); return
            spoke = any(o.get("type") == "message" and any(p.get("text") or p.get("transcript") for p in o.get("content", [])) for o in ev["response"].get("output", []))
            for c in calls:
                did, task = c["call_id"], json.loads(c["arguments"]).get("task", "")
                st["turn_delegated"] = True; self._pending.add(did)
                if not spoke: await self._send({"type": "response.create"})   # 1.5 speaks a preamble in the call response itself; a second ack would make it talk twice. No output yet: the call stays open and the model acknowledges. Bare: a body with instructions/tool_choice makes it greet from scratch
                self._tasks.append(asyncio.create_task(self._still_working(did)))
                self._emit("session.delegation.created", delegation={"id": did, "task": task}, offset_ms=int((time.monotonic() - self._t0) * 1000))
            self._emit("response.done", calls=len(calls), pending=len(self._pending))
        if "delta" not in t: self._emit("raw", raw_type=t)   # for DEBUG logging; consumers ignore it

    def _fake_claim(self) -> bool:
        v = self._st["last_voice"].lower(); self._st["last_voice"] = ""
        return bool(CLAIM.search(v)) or (bool(ASKED.search(self._st["last_user"].lower())) and bool(OFFER.search(v)))

    def __aiter__(self): return self
    async def __anext__(self):
        ev = await self._out.get()
        return ev

    async def close(self):
        for t in self._tasks: t.cancel()
        await self._ws.close()


class connect:
    """async with higgslive.connect() as conn"""
    def __init__(self, model="higgs-realtime", api_key=None, rate=24000, playback=True):
        """playback=False when the client does not play the audio (headless tests): commentary then never waits for a speaker."""
        self._model, self._key, self._rate, self._playback = model, api_key or os.environ["BOSON_API_KEY"], rate, playback
    async def __aenter__(self):
        ws = await websockets.connect(URL + self._model, additional_headers={"Authorization": f"Bearer {self._key}"}, max_size=None, open_timeout=20)
        self._conn = Conn(ws, self._rate, self._playback, self._model); return self._conn
    async def __aexit__(self, *a): await self._conn.close()


if __name__ == "__main__":   # self-check: no network
    assert _ev({"delegation": {"id": "x"}}).delegation.id == "x"
    assert CLAIM.search("i've sent that off") and not CLAIM.search("sure, what else?")
    assert all(CLAIM.search(x) for x in ("i've handed that task off", "i've handed off the task", "i'm handing off the request"))
    assert ASKED.search("make me a page") and OFFER.search("i'll create it for you")
    assert all(OFFER.search(x) for x in ("i can't create files myself, but i can delegate that. shall i set that up?", "shall i set that up?",
                                         "want me to delegate that?", "would you like me to hand that off?")) and not OFFER.search("sure, what else?")
    assert all(OFFER.search(x) for x in ("sure, i can draft a hero section for a tech company. what vibe are we going for?",   # the Oct 24 call, verbatim
                                         "i'll whip up a hero section with a clean layout", "let me put that together",
                                         "sure. i'll add a hero section to the page with a big heading")) and CLAIM.search("i'm putting together the hero section")
    assert all(ASKED.search(x) for x in ("can you tell them to plan a nice hero section", "add a sleek hero section to it", "update the colors"))
    assert not any(ASKED.search(x) for x in ("are you done? like.", "any update on that?", "do you have it yet?", "hello"))
    assert TOOL in MECHANICS and "[progress" not in MECHANICS and MECHANICS.index("Rule one") < MECHANICS.index(STATUS)
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:   # status_summary: working, idle, done, empty
        os.environ["HIGGS_HOME"], h, now = tmp, Path(tmp) / "herd", time.time()
        assert status_summary(now).startswith("No agents")
        for name, st in (("reviewer", {"state": "working", "task_id": "a1", "task": "review src/parser.py", "started": now - 999}),
                         ("donna", {"state": "idle", "task_id": "b2", "task": "make hello.txt"}), ("old", {"state": "dead"})):
            (h / name).mkdir(parents=True); (h / name / "status.json").write_text(json.dumps(st))
        (h / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in (
            {"ts": now - 125, "ev": "task.sent", "agent": "reviewer", "id": "a1", "task": "review src/parser.py"},
            {"ts": now - 60, "ev": "task.sent", "agent": "donna", "id": "b2", "task": "make hello.txt"},
            {"ts": now - 50, "ev": "task.note", "agent": "reviewer", "id": "a1", "text": "reading 14 files"},
            {"ts": now - 10, "ev": "task.done", "agent": "donna", "id": "b2", "text": "written to /Users/x/sandbox/hello.txt"})))
        s = status_summary(now - 30, [("open the page", now - 5, False)], now)
        assert "reviewer has been working on review parser.py for 2 minutes, latest note: reading 14 files." in s, s
        assert "donna is idle." in s and "donna finished make hello.txt: written to hello.txt" in s and "old" not in s, s
        assert "open the page, has been running for a few seconds" in s and "/" not in s and "{" not in s, s
        assert "finished" not in status_summary(now, (), now)   # done before the call: not reported
        c, sent = Conn(None, 24000), []   # thinking.append sends Higgs nothing; task_status still reports the note
        async def rec(ev): sent.append(ev)
        c._send, c._sent, c._open = rec, {"d1": ("make index.html", now)}, {"d1"}
        asyncio.run(c.session.thinking.append(content="writing index.html", delegation_id="d1"))
        assert sent == [], sent
        asyncio.run(c._handle({"type": "response.done", "response": {"output": [{"type": "function_call", "name": STATUS, "call_id": "s1"}]}}))
        assert "make index.html, has been running for a few seconds, latest note: writing index.html." in sent[0]["item"]["output"], sent
        sent.clear()   # status + delegate_task in one response: the status answer already counts the new task as running
        asyncio.run(c._handle({"type": "response.done", "response": {"output": [{"type": "function_call", "name": STATUS, "call_id": "s2"},
                                                                                 {"type": "function_call", "name": TOOL, "call_id": "d2", "arguments": '{"task": "open it"}'}]}}))
        assert "open it, has been running" in sent[0]["item"]["output"], sent
    c, sent = Conn(None, 24000), []   # GUARD while a task runs: only a new request without a call gets the nudge
    c._send, c.delegation, c._pending = rec, True, {"d1"}
    for user, voice, nudged in (("are you done? like.", "on it, just a sec while that updates.", False),
                                ("add a sleek hero section to it", "i'll whip up a hero section with a clean layout.", True)):
        sent.clear(); c._st.update(last_user=user, last_voice=voice, guarded=False, turn_delegated=False)
        asyncio.run(c._handle({"type": "response.done", "response": {"output": [{"type": "message", "content": [{"transcript": voice}]}]}}))
        assert any(e.get("item", {}).get("content", [{}])[0].get("text") == NUDGE for e in sent) == nudged, (user, sent)
    STILL_WORKING_AT = 0   # a "still working" note queued before or after the result came in is dropped; the result gets the cue
    async def stale_note():
        c, sent = Conn(None, 24000), []
        async def rec(ev):
            sent.append(ev)
            if ev["type"] == "conversation.item.create": c._st["added"].set()   # the server's item.added ack
        c._send, c._open, c._pending = rec, {"d1"}, {"d1"}
        await c._still_working("d1"); await c.session.commentary.append(content="Done, the page is open.", delegation_id="d1"); await c._still_working("d1")
        t = asyncio.create_task(c._speak_loop()); await asyncio.sleep(0.3); t.cancel()
        return sent
    sent = asyncio.run(stale_note())
    assert [e.get("item", {}).get("type") or e["type"] for e in sent] == ["function_call_output", "message", "response.create"], sent
    assert sent[0]["item"]["output"] == "Done, the page is open." and sent[1]["item"]["content"][0]["text"] == RESULT_CUE, sent
    print("ok")
