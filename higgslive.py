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
        await conn.session.thinking.append(content="reading the config", delegation_id=did)   # silent: context only
        await conn.session.commentary.append(content="Done, it's open.", delegation_id=did)   # spoken, when the voice is free
        await conn.session.instructions.append(content="The user is now on the pricing page.")

How it maps: the voice model calls a function tool; this layer leaves the call OPEN (Higgs tool calls are asynchronous: the
conversation continues with the output outstanding), requests one response so the model acknowledges, and emits
`session.delegation.created`. Thinking appends become user-role text items with no response requested, deleted when the
result lands. The first commentary append for a delegation waits until the voice is idle, the user is quiet and playback has
drained, then returns the real `function_call_output` and requests one response. Instructions appends re-send session.update.
"""
import asyncio, base64, itertools, json, logging, os, re, time
from types import SimpleNamespace
import websockets

log = logging.getLogger("higgslive")
URL = "wss://api.boson.ai/v1/realtime?model="
TOOL = "delegate_task"   # NOT "delegate": the server reserves that name for its own server-side tool (returns executor:"server", adds a `reason` arg; "delegation service not configured")
TOOL_DEF = {"type": "function", "name": TOOL, "description": "Hands a job to an agent on the user's computer that can "
            "create or edit files, open pages or files in the browser, run commands, read code, check git, look things up, calculate. "
            "Use it for ANY request to make, open, run, check, find or compute something. The task is a plain-English request, not a command.",
            "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]}}
MECHANICS = f"""## Delegation mechanics
You cannot create, open, read, run, or look up anything yourself; the {TOOL} tool hands the job to an agent that can.
Call {TOOL} first, then speak. Never say you can't, never ask for confirmation first. Describe the task in plain English as
a complete request (what, where, what the result should be), never as a shell command or code.
{TOOL} runs in the background; its result arrives later as the tool's output, often several turns after the call. Right after
calling it, say in one short sentence that you've handed it off, then ask what else you can help with while it runs. Keep the
conversation going on whatever the user brings up. Never guess or report the result before the tool's output arrives; when it
does, bring it up as a natural aside and give the outcome in your own words. Never report an action as done, running, or sent
unless you called {TOOL}.
Messages starting with "[progress" are notes about a running task: never read them out; use them only if the user asks how it's going."""
NUDGE = f"(system) No task was sent: you did not call {TOOL}. Call {TOOL} now for what the user asked, then say you've sent it off."
STILL_WORKING_AT = 25   # seconds before one spoken "taking longer than usual", per GPT-Live's "say something when a delay matters"
CLAIM = re.compile(r"\b(sen[dt]\w*\s+(that|it|this)\s+off|hand(ing|ed)\b[^.]{0,20}\boff|on it\b|i'?m\s+(creating|making|building|writing|checking|looking|running|opening|sending)|should be running|backend result)")
OFFER = re.compile(r"\b(i'?ll\s+(creat|mak|build|writ|check|look|run|open|get|find|count|send)|let me\s+(creat|mak|check|look|run|open|see)|"
                   r"i (can'?t|cannot|am not able to|'m not able to)\b[^.]{0,60}\b(directly|files?|code|computer|browser|access|run|open|create|make)|copy and paste|here'?s (a|the) (simple )?(example|code|html))")
ASKED = re.compile(r"\b(make|create|build|write|open|run|check|find|count|look ?up|search|calculate|show me|how many|what'?s in|list|generate|set up|fix|install|delete|rename|convert|download)\b")


def _ev(d):
    """dict → attribute access, recursively (ev.delegation.id)."""
    return SimpleNamespace(**{k: _ev(v) if isinstance(v, dict) else v for k, v in d.items()}) if isinstance(d, dict) else d


class _Channel:
    def __init__(self, fn): self.append = fn


class Conn:
    def __init__(self, ws, rate, playback=True, model="higgs-realtime"):
        self._ws, self._rate, self._playback, self._model = ws, rate, playback, model
        self._out: asyncio.Queue = asyncio.Queue()        # translated events for the consumer
        self._spoken: asyncio.Queue = asyncio.Queue()     # (text, delegation_id) waiting for a quiet moment
        self._st = dict(in_flight=False, user_speaking=False, spk_until=0.0, guarded=False, turn_delegated=False, last_user="", last_voice="", added=None)
        self._pending: set[str] = set()                   # delegations with no commentary yet
        self._open: set[str] = set()                      # function calls whose output we have not returned yet
        self._notes: dict = {}                            # delegation id → ids of its progress items
        self._seq = itertools.count()
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
            "instructions": self._instructions, "tools": ([TOOL_DEF] if self.delegation else []) + session.get("tools", []), "tool_choice": "auto",   # e.g. {"type": "web_search"}   # required/named break the server
            "audio": {"input": {"format": fmt, "noise_reduction": {"type": "near_field"}, "transcription": {"model": "higgs-stt-3.1"},
                                "turn_detection": session.get("turn_detection", {"type": "server_vad"})},   # server defaults (threshold 0.85 as of Oct 23) = the baseline; tune from there
                      "output": {"format": fmt, "voice": session.get("voice", "default")}},
            "temperature": session.get("temperature", 0.5)}})
        self._tasks = [asyncio.create_task(self._pump()), asyncio.create_task(self._speak_loop())]

    # ---- the three return channels + inputs ------------------------------------------------------------------------
    async def _commentary(self, content: str, delegation_id: str | None = None):
        await self._spoken.put((content[:1500], delegation_id))

    async def _thinking(self, content: str, delegation_id: str | None = None):
        # user-role (assistant-role notes made the model continue them and invent results); deleted again when the result lands, so they are never echoed
        iid = f"prog_{next(self._seq)}"; self._notes.setdefault(delegation_id, []).append(iid)   # ids must be unique: back-to-back notes land in the same ms
        await self._item(f"[progress on the task you sent off]: {content[:1500]}", iid)
        log.info("  ~ note: %s", content)

    async def _instructions_append(self, content: str, delegation_id: str | None = None):
        self._instructions += "\n" + content
        await self._send({"type": "session.update", "session": {"type": "realtime", "instructions": self._instructions}})   # per-response overrides break; session-level works

    async def _audio(self, pcm: bytes):
        await self._send({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm).decode()})

    async def _text(self, content: str):
        self._st.update(guarded=False, turn_delegated=False, last_user=content)
        await self._item(content); await self._send({"type": "response.create"})

    async def _item(self, text: str, iid: str | None = None):
        await self._send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}], **({"id": iid} if iid else {})}})

    async def _speak_loop(self):
        # ponytail: one result at a time, oldest first; no priority, no coalescing
        while True:
            text, did = await self._spoken.get()
            st = self._st
            while st["in_flight"] or st["user_speaking"] or time.monotonic() < st["spk_until"] + 1.0:   # voice idle, user quiet, playback drained + a beat
                await asyncio.sleep(0.1)
            for iid in self._notes.pop(did, []): await self._send({"type": "conversation.item.delete", "item_id": iid})   # progress served its purpose; the result replaces it
            st["added"] = asyncio.Event()
            if did in self._open:   # the native path: the call stayed open all this time; this is its real output (confirmed with Boson, Oct 23)
                self._open.discard(did)
                await self._send({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": did, "output": text}})
            else:                   # no open call (opener, "still working" note, a second update for the same task): plain text item
                await self._item(text)
            try: await asyncio.wait_for(st["added"].wait(), 3)   # the server must add the item before we ask for the reply, or it answers without it
            except asyncio.TimeoutError: log.warning("no item.added ack before response.create")
            await self._send({"type": "response.create"})
            if did: self._pending.discard(did)
            log.info("→ commentary %s (%d chars)", did or "(no delegation)", len(text))
            self._out.put_nowait(_ev({"type": "session.commentary.appended", "delegation_id": did}))

    async def _still_working(self, did: str):
        await asyncio.sleep(STILL_WORKING_AT)
        if did in self._pending: await self._spoken.put(("[note] The task you handed off is still in progress and taking longer than usual; tell the user in a few words.", None))

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
            if self.delegation and not calls and self._fake_claim() and not st["guarded"] and not st["turn_delegated"]:
                st["guarded"] = True   # ponytail: one forced retry per user turn, no loop
                log.info("GUARD: reply claimed or offered a task without calling %s — nudging", TOOL)
                await self._item(NUDGE); await self._send({"type": "response.create"}); return
            spoke = any(o.get("type") == "message" and any(p.get("text") or p.get("transcript") for p in o.get("content", [])) for o in ev["response"].get("output", []))
            for c in calls:
                did, task = c["call_id"], json.loads(c["arguments"]).get("task", "")
                st["turn_delegated"] = True; self._pending.add(did); self._open.add(did)
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
    assert TOOL in MECHANICS and "[progress" in MECHANICS
    print("ok")
