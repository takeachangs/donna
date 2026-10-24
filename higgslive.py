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
the user); the layer keeps the latest one per delegation for `task_status`. A result waits until the voice is idle, the user has been quiet for a while, the voice has no question
open and playback has drained (or HOLD_MAX passes), then returns the real `function_call_output` plus a one-line cue and requests one response; if the user
starts talking first it rides in on their turn. kind="ask" appends skip that wait: the voice puts the agent's question to the user. Instructions appends re-send session.update.
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
            "parameters": {"type": "object", "properties": {"task": {"type": "string"},   # replaces: set on 7/7 corrections, 0/6 second tasks (Oct 24 text probe)
                           "replaces": {"type": "boolean", "description": "true when this request corrects or changes the one you sent just before; the earlier one is dropped"}},
                           "required": ["task"]}}
STALE = "Dropped: the user changed this request and the new call replaces it. Say nothing about it."   # closes the replaced call; no response.create
REPLACING = re.compile(r"\b(replacing|instead of) the (previous|earlier|last) (request|task)\b", re.I)   # 2/2 misses of the flag said this in the task text
STATUS = "task_status"   # answered at once by this layer from the herd files; never left open
STATUS_DEF = {"type": "function", "name": STATUS, "description": f"How the work you sent with {TOOL} is going: the agents (workers) "
              "and what each is doing or has finished, running and queued tasks, questions waiting for the user, results not told yet. "
              "Only for the work and the team.", "parameters": {"type": "object", "properties": {}}}   # naming files/folders here pulled "what's in my directory" to this tool (2/6 runs)
MECHANICS = f"""## Delegation mechanics
Rule one: when the user asks for anything to be made, opened, run, checked, found or computed, call {TOOL} immediately in that
same turn. Never say you can't do it yourself, never offer to delegate, never ask whether to proceed: the user already asked.
A request to add, change, design, plan, style or improve something on a page or file is work too: call {TOOL} with your best
reading of it. If a detail is missing, pick a sensible default, say which, and let the user correct it; never interview the user
before calling. A question about what is in a file, folder or directory, or on the computer, is work too: call {TOOL}.
After the call, one short sentence that it's underway.
Reply to what the user just said. Mention a running task only if they ask or when its result arrives.
{TOOL} hands the job to an agent on the user's computer. The task is the user's request in their own words, lightly cleaned up,
never a shell command or code. A "this", "that" or "it" the call has not explained stays as they said it, with "(unclear what)"
after it; never fill it in with a guess. Such a request is still work: call {TOOL} at once; the agent finds out what they mean and
asks back through you if it must. Never ask the user what "this" is or for more details yourself. It runs in the background; its result arrives later as the tool's
output, often several turns after the call. Never guess or report the result before it arrives; when it does, bring it up as a
natural aside and give the outcome in your own words. Never report an action as done, running, or sent unless you called {TOOL}.
When the user asks how it's going, what's happening, whether something is done, or about the agents, workers, team, office,
lounge, updates or reports, call {STATUS} and answer from its output; while a task is running, even a casual "how's it going" means
the task. {STATUS} is only for the work and who is doing it; if it can't answer what they asked, never say you're checking the status.
What the user asked you earlier ("what did I tell you to start?") is in {STATUS} too. Never claim progress or results you did not get from a tool.
When a task's result arrives while the user is talking or has just asked you something, answer what they said first, then mention the finished task as an aside in one sentence.
When the agent working on a task needs a decision, you will get its question as a note: ask the user plainly in your own words and wait. Their next answer is passed back to the agent automatically; do not call {TOOL} for it, do not repeat the question, just acknowledge.
Never narrate state changes nobody asked about: a task starting, being queued or being picked up is not news; only results, questions and what the user asks."""
NUDGE = f"(system) No task was sent: you did not call {TOOL}. Call {TOOL} now with what the user asked, in their words, then say you've sent it off."
RESULT_CUE = "[the result above just arrived; tell the user now in one or two sentences]"   # user-role, after the output: without it the model answered an earlier "still working" note instead (Oct 24 call)
QUIET = 2.5       # seconds of silence from everyone before a result is spoken: Oct 24 call, the voice asked the user a question and 6 s later dropped it to say "Done, your page is open"
RECENT_USER = 3.0  # ...and the user must not have spoken within this long
HOLD_MAX = 10     # a result held this long goes out anyway (the user may never answer)
QUESTION_MAX = 6  # ...and one held only for an unanswered voice question goes out after this much silence: they are not going to answer
CLOSER = re.compile(r"\b(how can i help|what can i (do|help)|anything else|what else|what'?s (up|next|on your mind)|need anything|let me know)\b[^?]*\?\s*$")   # a stock closer is not an open question
TASK_Q = re.compile(r"\b(which|should|do you want|prefer|blue or|or)\b")   # a real question needs a decision in it


def open_question(voice: str) -> bool:
    """The voice's last utterance is a question the user is expected to answer (PR #24 review: "How can I help you today?" held a result 20 s)."""
    v = voice.strip().lower()
    return v.endswith("?") and not CLOSER.search(v) and len(v.split()) >= 5 and bool(TASK_Q.search(v))
STILL_WORKING_AT = 25   # seconds before one spoken "taking longer than usual", per GPT-Live's "say something when a delay matters"
CLAIM = re.compile(r"\b(sen[dt]\w*\s+(that|it|this)\s+off|hand(ing|ed)\b[^.]{0,20}\boff|on it\b|i'?m\s+(creating|making|building|writing|checking|looking|running|opening|sending|whipping|drafting|putting|setting|sketching|reaching|connecting|transferring|getting)|should be running|backend result|i'?ll\s+have\s+(the|an|my)\s+agent)")   # the last: "I'll have the agent take a look" (Oct 24 probe)
OFFER = re.compile(r"\b(i'?ll\s+(creat|mak|build|writ|check|look|run|open|get|find|count|send|add|chang|design|plan|styl|improv|updat|connect|put|transfer)|let me\s+(creat|mak|check|look|run|open|see)|"
                   r"i (can'?t|cannot|am not able to|'m not able to)\b[^.]{0,60}\b(directly|files?|code|computer|browser|access|run|open|create|make)|copy and paste|here'?s (a|the) (simple )?(example|code|html)|"
                   r"shall i (set|get|start) (that|it|this)|(want|like) me to (delegate|hand|send|set|go ahead)|i (can|could) delegate|"
                   r"(i'?ll|i (can|could)|let me)\s+(whip|draft|put (\w+ )?together|set (\w+ )?up|sketch)|"
                   r"(could|can) you (please )?(provide|share|tell me more)|what \W?(this|that|it)\W? refers to|you'?re referring to|need (a bit |some )?more detail)")   # asking permission instead of calling; offering to draft (Oct 24 calls); interviewing about "this" (#43 probe: 7/20)
PATH = re.compile(r"(?:~|\.{1,2})?/?(?:[\w.-]+/)+([\w.-]+)")   # a/b/c.txt → c.txt: no paths in speech
PENDING_LINE = "Still on it; I'll call you when it's done."   # what a reply that reports a result nobody sent is replaced by (#32)
DONE = re.compile(r"\b(has|have|'s|is|was|are|were)\s+(been\s+)?(now\s+|all\s+)?(ready|live|in place)\b|(?<!you're )(?<!you are )\ball set\b|(?<!we're )(?<!you're )(?<!i'm )\bdone\b|"
                  r"\b(finished|completed|added|created|written|wrote|built|fixed|updated|saved|backed up|deployed|pushed|merged|committed|published|installed|deleted|renamed)\b")   # "we're done here" is the call
LATER = re.compile(r"\b(when|once|until|till|soon|if|will|not|yet|still|being|going to|about to|who|what|which|whether|check|checking|find out|look|looking)\b|'ll|n't|\?\W*$")   # "I'll call you when it's done" is a promise, not a claim
FIX = "(system) No result has come in yet; the task is still running. Your last reply was wrong and was not played. Say exactly this and nothing else: \"{}\""
REPEAT = ("(system) Not played: you already said \"{}\" Never say it again. Answer the user's last words in different words; "   # Oct 24 call: six user turns in 50 s, one answer
          f"if they asked for something, call {TOOL}.")   # each, "Still working on that website and marketing plan for you." (#36)
NOT_NAMES = set("the and also make please can you your for with that this from into some new all set".split())   # words that name no task
REPEAT_WINDOW, REPEAT_MIN_WORDS = 60, 2   # ponytail: 2 words catches "Still running." (a loop line); raise it if "Got it." style fillers count as repeats


def sentences(voice: str) -> list:
    """The reply's sentences, lower case, words only (the split `fabricated` uses)."""
    return [" ".join(re.findall(r"[a-z0-9']+", p.lower().replace("’", "'"))) for p in re.split(r"(?<=[.!?;\]}])\s+", voice.strip())]


def fabricated(voice: str, told=lambda s: False) -> str | None:
    """The reply with its first sentence that reports a result swapped for PENDING_LINE (later ones dropped), or None if it reports none.
    Reports: a tag read aloud ([NOTE: task finished…], a JSON tool result: Oct 24 rehearsal, 2/4 baseline runs) or a done claim not about
    later that `told` (the lower-cased sentence → a result came in for it) does not back."""
    out, used = [], False
    for p in re.split(r"(?<=[.!?;\]}])\s+", voice.strip()):   # "]" too: "[NOTE: …] Hanging up now." keeps the sign-off
        v = p.lower().replace("’", "'")
        tag = re.search(r"[\[\]{}]", v)
        if not (tag or DONE.search(v) and not LATER.search(v)) or not tag and told(v): out.append(p)
        elif not used: out.append(PENDING_LINE); used = True
    return " ".join(out) if used else None


def words(text: str) -> set:
    """The words that can name a task, cut to 4 letters ("backed up" names "a backup"): how a claim is matched to its task (#55)."""
    return {w[:4] for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in NOT_NAMES}


def _for(secs: float) -> str:
    m = round(secs / 60)
    return "a few seconds" if secs < 45 else f"{m} minute{'s' * (m != 1)}" if m < 90 else f"{round(secs / 3600)} hours"


def office_status(home: Path) -> tuple[list, set]:
    """Sentences from office.json: the workers by status, then each result the user has not heard; and those results' task ids.
    #43: "how many agents?", "any reports?" got "donna is idle" while the office had workers and three unspoken results."""
    try: o = json.loads((home / "office.json").read_text())
    except (OSError, ValueError): return [], set()
    if not isinstance(o, dict): return [], set()
    ws = [w for w in o.get("workers") or [] if isinstance(w, dict) and not w.get("lead") and w.get("name")]
    run = [w["name"] + (f" ({w['role']})" if w.get("role") else "") for w in ws if w.get("status") == "working"]
    rest = [w["name"] for w in ws if w.get("status") != "working"]
    new = [b for b in o.get("briefings") or [] if isinstance(b, dict) and b.get("status") == "queued" and b.get("summary")]
    return ([f"{len(ws)} worker{'s' * (len(ws) != 1)} this session: " + "; ".join(
        ([f"working: {', '.join(run)}"] if run else []) + ([f"finished, resting in the lounge: {', '.join(rest)}"] if rest else [])) + "."] if ws else []) \
        + [f"Not told to the user yet: {b['summary']}" for b in new], {b.get("id") for b in new}


def status_summary(since: float, sent=(), now: float | None = None) -> str:
    """One spoken paragraph from $HIGGS_HOME/herd (status.json per agent + events.jsonl): who works on what and for how long,
    who is idle, what finished since `since` (epoch). sent: (task, started_epoch, finished[, latest_note]) for this call's own delegations.
    First, from $HIGGS_HOME/office.json (herd.office, #43): the duty period's workers by status and the results the user has not heard."""
    now, home = now or time.time(), Path(os.environ.get("HIGGS_HOME") or Path.home() / ".higgs")
    herd = home / "herd"
    evs = [json.loads(l) for l in (herd / "events.jsonl").read_text().splitlines() if l.strip()] if (herd / "events.jsonl").exists() else []
    sent_at = {e.get("id"): e for e in evs if e.get("ev") == "task.sent"}
    last = {e["agent"]: e for e in evs if e.get("ev") in ("task.note", "task.done")}
    (out, told), idle, known = office_status(home), [], set()   # told: listed as not told yet, so not again as "finished"; known: task texts in per-task records (ring mode: the same task also arrives in `sent`)
    for f in sorted(herd.glob("*/status.json")):
        name, st = f.parent.name, json.loads(f.read_text())
        if st.get("state") == "dead": continue
        tid = st.get("task_id")   # no "tasks" key: the agent-level state stands for one record
        recs = st["tasks"] if "tasks" in st else {tid: {"state": "in_progress", "task": st.get("task"), "ts": sent_at.get(tid, {}).get("ts", st.get("started") or now)}} if st.get("state") == "working" else {}
        known.update(r.get("task") for r in recs.values() if "tasks" in st)
        queued = []
        for tid, r in recs.items():
            task = (r.get("task") or "a task").rstrip(".")   # the voice's task lines end in "." ("…harder..", "…site.: Blue or green?")
            if r.get("state") == "in_progress":
                e = last.get(name)
                out.append(f"{name} has been working on {task} for {_for(now - r.get('ts', now))}" + (f", latest note: {e['text']}" if e and e["ev"] == "task.note" and e.get("id") == tid else "") + ".")
            elif r.get("state") == "needs_you": out.append(f"{name} is waiting for your answer on {task}: {r.get('asked')}")
            elif r.get("state") == "queued": queued.append(task)
        if queued: out.append(f"{len(queued)} task{'s' * (len(queued) != 1)} waiting in {name}'s queue: {', '.join(queued)}.")
        p = f.parent / "meta.json"; t0 = json.loads(p.read_text()).get("since") or 0 if p.exists() else 0   # this duty period (#31), before this call: "what did I ask you earlier?" (#43)
        if earlier := [r["task"].rstrip(".") for r in recs.values() if r.get("state") == "done" and r.get("task") and t0 <= r.get("ts", 0) < since]:
            out.append(f"Done for {name} earlier this session: {'; '.join(earlier)}.")
        if not (queued or any(r.get("state") in ("in_progress", "needs_you") for r in recs.values())): idle.append(name)
    if idle: out.append(f"{', '.join(idle)} {'is' if len(idle) == 1 else 'are'} idle.")
    for e in evs:
        if e.get("ev") == "task.done" and e.get("ts", 0) >= since and e.get("id") not in told:
            out.append(f"{e['agent']} finished {sent_at.get(e.get('id'), {}).get('task') or 'a task'}: {e.get('text', '')}")
        if e.get("ev") == "task.failed" and e.get("ts", 0) >= since:
            out.append(f"{e['agent']} could not finish {sent_at.get(e.get('id'), {}).get('task') or 'a task'}: {e.get('text', '')}")
    for task, t, done, *note in sent:
        if task in known: continue
        out.append(f"The task sent on this call, {task}, " + ("is finished." if done else f"has been running for {_for(now - t)}"
                   + (f", latest note: {note[0]}" if note and note[0] else "") + "."))
    return PATH.sub(r"\1", " ".join(out)) or "No agents are running and nothing has finished since the call started."


ASKED = re.compile(r"\b(make|create|build|write|open|run|check|find|count|look ?up|search|calculate|show me|how many|what'?s in|list|generate|set up|fix|install|delete|rename|convert|download|"
                   r"add|change|design|plan|style|improve|update (the|it|that|this|my)|(put|turn) (it|this|that)|tell (them|it|someone)|have (them|someone)|"
                   r"who('?s| is| was)? (built|made|wrote|did|working on|worked on|on|in charge of)|on the line|put me through|connect me|talk to|speak (to|with))\b")   # not bare "update"/"have it": "any update?", "do you have it?" ask about a running task; "who built the quiz?" and "get me on the line" go to the brain (#28)


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
        self._spoken: asyncio.Queue = asyncio.Queue()     # (text, delegation_id, note_for, kind) waiting for a quiet moment
        self._st = dict(in_flight=False, user_speaking=False, spk_until=0.0, guarded=False, turn_delegated=False, last_user="", last_voice="", added=None,
                        user_at=0.0, voice_at=0.0, question=False, asked=False, att=None, late=False, fix=None, fresh=False)   # fix: a fabricated reply's corrected text; fresh: a result went in since the user's turn began; *_at: monotonic; question: the voice's last words were a question; asked: an ask was delivered this turn; att/late: attached item's ack
        self._held = None                                 # the queue entry _speak_loop is holding; whoever sets it to None sends it
        self._lock = asyncio.Lock()                       # item(s) + added ack + response.create go out as one unit
        self._asking = 0                                  # asks not yet delivered: results wait behind them
        self._pending: set[str] = set()                   # delegations with no commentary yet
        self._arrived: set[str] = set()                   # delegations whose result came in (queued or spoken): their "still working" note is stale
        self._open: set[str] = set()                      # function calls whose output we have not returned yet
        self._stale: set[str] = set()                     # delegations a correction replaced: their result is dropped, never spoken
        self._notes: dict = {}                            # delegation id → its latest progress note, for task_status only
        self._sent: dict = {}                             # delegation id → (task, epoch) for task_status
        self._said: list = []                             # (sentence, monotonic) the voice said in the last REPEAT_WINDOW s (#36)
        self._instructions = ""
        self._relay = False   # a worker's voice (#28): every user turn is for the agent; see _start
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
        self._relay = session.get("relay", False)   # a worker's voice (#28): every user turn goes to delegate_task (the claim GUARD treats each as a request), and the result guard is off: "I built the quiz" is her history
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
    async def _commentary(self, content: str, delegation_id: str | None = None, kind: str = "say"):
        if delegation_id in self._stale:   # the user corrected this request: its result answers the old question
            log.info("dropped stale result %s: %s", delegation_id, content[:80]); self._done(delegation_id, "dropped"); return
        if kind == "ask":   # the agent needs a decision: not a result, so it skips the queue and the hold
            self._asking += 1; self._tasks.append(asyncio.create_task(self._ask(content, delegation_id))); return
        self._arrived.add(delegation_id)
        await self._spoken.put((("The task failed: " + content if kind == "fail" else content)[:1500], delegation_id, None, kind))

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
        self._st.update(guarded=False, turn_delegated=False, last_user=content, question=False, asked=False, user_at=time.monotonic(), fresh=False)
        held, self._held = self._held, None   # a typed turn counts as speech: the held result goes in just before it
        if held: await self._attach(held, False)
        await self._item(content); await self._send({"type": "response.create"})

    async def _item(self, text: str):
        await self._send({"type": "conversation.item.create", "item": _msg(text)})

    def _idle(self, now: float) -> bool:   # voice idle, user not talking, playback drained
        st = self._st
        return not (st["in_flight"] or st["user_speaking"] or now < st["spk_until"])

    def _ready(self, now: float) -> bool: return self._idle(now) and not self._asking   # results also wait behind a pending ask

    async def _send_items(self, items):
        st = self._st
        for item in items:
            st["added"] = asyncio.Event()
            await self._send({"type": "conversation.item.create", "item": item})
            try: await asyncio.wait_for(st["added"].wait(), 3)   # the server must add each item before we ask for the reply, or it answers without it
            except asyncio.TimeoutError: log.warning("no item.added ack before response.create")
        st["in_flight"] = True   # optimistic, before the send (response.done may beat us back): the other sender waits
        await self._send({"type": "response.create"})

    def _items(self, text: str, did: str | None, cue=False) -> list:
        if task := self._sent.get(did, ("",))[0]: text = f'Result for "{task.strip()}": {text}'   # with three calls open, a bare "Done." for the first was told as the last (#55)
        if did in self._open:   # the native path: the call stayed open all this time; this is its real output (confirmed with Boson, Oct 23)
            self._open.discard(did)
            return [{"type": "function_call_output", "call_id": did, "output": text}] + ([_msg(RESULT_CUE)] if cue else [])
        return [_msg(text)]     # no open call (opener, "still working" note, a second update for the same task): plain text item

    def _done(self, did, kind):
        if kind != "dropped": self._st.update(fresh=True, result_at=time.monotonic())   # the reply that follows may report it
        if did: self._pending.discard(did)
        self._emit("session.commentary.appended", delegation_id=did, kind=kind)

    async def _attach(self, entry, voice: bool):
        """The user started a turn while `entry` was held: put it in the conversation now, no response.create (the server answers the turn anyway)."""
        text, did, about, kind = entry
        if about: return   # a "still working" note: the user is talking to her, so it would be answered instead of them (Oct 24 call, #36)
        if voice: self._st["att"] = asyncio.Event()   # set by its item.added; if response.created beats it, the model never saw the result
        for item in self._items(text, did): await self._send({"type": "conversation.item.create", "item": item})
        log.info("→ attached held result %s to the user's turn", did or "(no delegation)")
        self._done(did, kind)

    async def _ask(self, question: str, did):
        text = (f"[note] Before the task you sent off can go on, the user has to decide: {question} Ask them this plainly, in your own words, as your own "
                f"question (never say an agent is asking); wait for their answer; do not call {TOOL} for it, it is passed back automatically.")
        try:
            while True:
                while not self._idle(time.monotonic()): await asyncio.sleep(0.1)
                async with self._lock:
                    if not self._idle(time.monotonic()): continue
                    self._st.update(question=True, asked=True)   # the voice is about to ask: nothing is spoken over the unanswered question, whatever its wording
                    await self._send_items([_msg(text)])
                    break
        finally: self._asking -= 1
        log.info("→ ask %s", did or "(no delegation)")
        self._emit("session.commentary.appended", delegation_id=did, kind="ask")

    async def _speak_loop(self):
        # ponytail: one result at a time, oldest first, each held by the speech policy; no coalescing
        st = self._st
        while True:
            entry = await self._spoken.get()
            text, did, about, kind = entry   # about: the delegation a "still working" note is for
            self._held, t0, logged = entry, time.monotonic(), False
            while self._held is entry:   # _attach (the user spoke or typed) takes it out
                if about and about in self._arrived: self._held = None; break   # its result came in while the note waited: the result wins (Oct 24 call)
                now = time.monotonic()
                if self._ready(now):
                    quiet = now - max(st["spk_until"], st["voice_at"], st["user_at"])
                    why = ("voice question unanswered" if st["question"] else f"user spoke {now - st['user_at']:.0f} s ago" if now - st["user_at"] < RECENT_USER
                           else f"waiting for {QUIET} s of quiet" if quiet < QUIET else None)
                    if why is None or now - t0 >= HOLD_MAX or (st["question"] and now - t0 >= QUESTION_MAX):
                        async with self._lock:
                            if self._held is entry and self._ready(time.monotonic()):   # re-check: an ask or an attach may have got in
                                self._held = None
                                await self._send_items(self._items(text, did, cue=True))
                                log.info("→ commentary %s (%d chars) after %.1f s quiet", did or "(no delegation)", len(text), quiet)
                                self._done(did, kind)
                        if self._held is not entry: break
                    elif not logged: log.info("holding result %s: %s", did or "(no delegation)", why); logged = True
                await asyncio.sleep(0.1)

    async def _still_working(self, did: str):
        t0 = time.monotonic(); await asyncio.sleep(STILL_WORKING_AT)
        if did in self._pending and self._st["user_at"] < t0 and time.monotonic() - self._st.get("still_at", -1e9) >= STILL_WORKING_AT:   # a silent wait only (the user
            self._st["still_at"] = time.monotonic()   # spoke since: they are not waiting), and one note for all running tasks (#36 probe: three tasks, three identical lines)
            await self._spoken.put(("[note] The task you handed off is still in progress and taking longer than usual; tell the user in a few words.", None, did, "say"))

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
        if t == "session.created":   # it echoes the applied config: the voice actually in use (#28 checks a transfer by it)
            self._emit("session.started", voice=(((ev.get("session") or {}).get("audio") or {}).get("output") or {}).get("voice")); return   # the first session.update is not acknowledged; the socket is ordered, so it applies before any turn
        if t == "error": self._emit("error", error=ev["error"]); return
        if t in ("session.idle_timeout", "session.max_duration_reached"): self._emit("session.closed", reason=t); return
        if t == "conversation.item.added":
            for k in ("added", "att"):
                if st[k]: st[k].set()
        if t == "response.created":
            st["in_flight"] = True
            if st["att"]: st["late"], st["att"] = not st["att"].is_set(), None   # the turn's response began before the attached result was acked

        if t == "input_audio_buffer.speech_started":
            st.update(user_speaking=True, guarded=False, turn_delegated=False, spk_until=0.0, fresh=False)   # barge-in: the server stops the response; playback is the client's to clear
            st.update(question=False, asked=False)   # the user is answering it (or ignoring it)
            self._emit("session.input_speech_started")
            held, self._held = self._held, None   # the server answers this turn whatever we do (create_response is ignored), so the result goes in before it ends
            if held: await self._attach(held, True)
        if t == "input_audio_buffer.speech_stopped": st.update(user_speaking=False, user_at=time.monotonic()); self._emit("session.input_speech_stopped")
        if t == "conversation.item.input_audio_transcription.completed":
            st["last_user"] = ev.get("transcript") or ""; self._emit("session.input_transcript.done", transcript=st["last_user"])
        if t == "response.output_audio.delta":
            if self._playback:   # ponytail: playback end estimated from bytes; add a client hook if it drifts
                now = time.monotonic(); st["spk_until"] = max(st["spk_until"], now) + len(ev["delta"]) * 3 // 4 / (self._rate * 2)
            self._emit("session.output_audio.delta", delta=ev["delta"])
        if t == "response.output_audio_transcript.delta": self._emit("session.output_transcript.delta", delta=ev["delta"])
        if t == "response.output_audio_transcript.done":
            # a task runs whose result has not come in, none went in this turn, and the claim is not backed by one that came in (#55: _told)
            if not self._relay and self.delegation and self._pending - self._arrived and not st["fresh"] and (fixed := fabricated(ev["transcript"], self._told)):   # a result nobody sent (#32)
                log.info("fabricated: %r → %r", ev["transcript"], fixed)
                if not st["guarded"]:   # dropped unplayed; the voice says the fixed line at response.done (one retry per user turn, like GUARD)
                    st.update(guarded=True, fix=fixed, spk_until=0.0); self._emit("session.output_audio.discard"); return
                ev["transcript"] = fixed   # a second one in the same turn: the transcript (and the sign-off it keeps) is right at least
            rep, whole = self._repeats(ev["transcript"])
            if rep and self.delegation and self._pending:   # the same line again while a task runs (#36)
                answered = st.get("heard_at", 0) > st["user_at"]   # the user already heard a reply this turn (a claim before GUARD's call, an earlier ack)
                drop = whole and not st["fresh"] and (answered or st.get("retried") != st["user_at"] and not st["turn_delegated"])   # never a result, never a turn left silent
                log.info("repeat: %s%s", rep, "" if not drop else " → dropped" if answered else " → dropped, retrying")
                if drop:
                    st.update(repeat=not answered and ev["transcript"], guarded=True, spk_until=0.0, last_voice=ev["transcript"]); self._emit("session.output_audio.discard"); return   # answered: just dropped
            st["heard_at"] = time.monotonic()
            st["last_voice"], st["question"] = ev["transcript"], st["asked"] or open_question(ev["transcript"]); self._emit("session.output_transcript.done", transcript=ev["transcript"])
        if t == "response.done":
            st["in_flight"] = False; st["voice_at"] = time.monotonic()
            if st["late"]:   # no await on _speak_loop here: in_flight clears in this very function
                st["late"] = False   # ponytail: a second response.create if this same response also delegated; rare, accepted
                await self._item("[the task result above arrived during that turn; mention it now in one sentence]"); await self._send({"type": "response.create"})
            calls = [o for o in ev["response"].get("output", []) if o.get("type") == "function_call" and o.get("name") == TOOL and o.get("executor") != "server"][:1]   # server-side tools (web_search, Oct 23) need no output from us. [:1]: 1.0 fires 2-3 near-duplicate calls for one request (9/12, probe/r15/A-tools.md); extras left open cause no error
            status = [o for o in ev["response"].get("output", []) if o.get("type") == "function_call" and o.get("name") == STATUS and o.get("executor") != "server"][:1]
            if st["fix"] and not calls and not status:
                st["in_flight"] = True; await self._item(FIX.format(st["fix"])); st["fix"] = None
                await self._send({"type": "response.create"}); return   # no response.done for the consumer: the fixed reply's is the one
            st["fix"] = None
            if (said := st.pop("repeat", False)) and not calls and not status:   # ponytail: a repeat that came with a call has lost its audio; the call goes on, unacknowledged
                nudge = NUDGE if self._fake_claim() and ASKED.search(st["last_user"].lower()) else REPEAT.format(said)   # "I'm on it." again to a new request: GUARD's nudge gets the call made
                st.update(in_flight=True, retried=st["user_at"]); await self._item(nudge); await self._send({"type": "response.create"}); return   # one retry per user turn (a status answer is guarded too)
            self._sent.update({c["call_id"]: (json.loads(c["arguments"]).get("task", ""), time.time()) for c in calls})   # before the status answer: a status call in
            self._open.update(c["call_id"] for c in calls)   # the same response must see this task running, or it reads "idle" and says "done"
            for c in status:   # synchronous: answered now, never enters _pending/_open
                text = status_summary(self._t0 - time.monotonic() + time.time(), [(t, ts, d not in self._open, self._notes.get(d)) for d, (t, ts) in self._sent.items()])
                await self._send({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": c["call_id"], "output": text}})
                log.info("%s → %s", STATUS, text)
            if status and not calls:
                st["guarded"] = True; await self._send({"type": "response.create"})   # same socket, so the output is added before the reply is made
                self._emit("response.done", calls=1, pending=len(self._pending)); return
            if self.delegation and not calls and self._fake_claim() and not st["asked"] and not st["guarded"] and not st["turn_delegated"] \
                    and (not self._pending or self._relay or ASKED.search(st["last_user"].lower())):   # a task is running: "on it" to "are you done?" is no fake claim (Oct 24 call)
                st["guarded"] = True   # ponytail: one forced retry per user turn, no loop
                log.info("GUARD: reply claimed or offered a task without calling %s — nudging", TOOL)
                await self._item(NUDGE); await self._send({"type": "response.create"}); return
            spoke = any(o.get("type") == "message" and any(p.get("text") or p.get("transcript") for p in o.get("content", [])) for o in ev["response"].get("output", []))
            for c in calls:
                a = json.loads(c["arguments"]); did, task = c["call_id"], a.get("task", "")
                old = next((d for d in reversed(self._sent) if d in self._pending), None) if a.get("replaces") or REPLACING.search(task) else None
                if old:   # a correction: the replaced call is closed at once, its result dropped when it lands
                    self._stale.add(old); self._pending.discard(old); self._open.discard(old); self._sent.pop(old, None)
                    await self._send({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": old, "output": STALE}})
                    log.info("delegation %s replaces %s", did, old)
                st["turn_delegated"] = True; self._pending.add(did)
                if not spoke: await self._send({"type": "response.create"})   # 1.5 speaks a preamble in the call response itself; a second ack would make it talk twice. No output yet: the call stays open and the model acknowledges. Bare: a body with instructions/tool_choice makes it greet from scratch
                self._tasks.append(asyncio.create_task(self._still_working(did)))
                self._emit("session.delegation.created", delegation={"id": did, "task": task, "replaces": old}, offset_ms=int((time.monotonic() - self._t0) * 1000))
            self._emit("response.done", calls=len(calls), pending=len(self._pending))
        if "delta" not in t: self._emit("raw", raw_type=t)   # for DEBUG logging; consumers ignore it

    def _repeats(self, voice: str) -> tuple[list, bool]:
        """Sentences of `voice` already said in the last REPEAT_WINDOW s (PENDING_LINE, said verbatim on purpose, aside) and whether
        that is all of it; records them (#36)."""
        now, mine = time.monotonic(), set(sentences(PENDING_LINE))
        self._said = [(s, t) for s, t in self._said if now - t < REPEAT_WINDOW]
        said, new = {s for s, _ in self._said}, [s for s in sentences(voice) if len(s.split()) >= REPEAT_MIN_WORDS and s not in mine]
        self._said += [(s, now) for s in new]
        rep = [s for s in new if s in said]
        return rep, bool(new) and len(rep) == len(new)

    def _told(self, claim: str) -> bool:
        """A done claim a result backs (#55): it names a task whose result came in (queued or spoken, any turn) over every running one,
        or names none and a result went in after the last reply the user heard (the user's turn cut that reply short: #49 run)."""
        w = words(claim); score = {d: len(w & words(t)) for d, (t, _) in self._sent.items()}
        best = max(score.values(), default=0); top = {d for d, n in score.items() if n == best}
        if best and top <= self._arrived: return True
        if best and not top & self._arrived: return False   # names a running task: the #32 case
        return self._st.get("result_at", 0) > self._st.get("heard_at", 0)   # ponytail: a tie or no task words falls back to timing

    def _fake_claim(self) -> bool:
        v = self._st["last_voice"].lower(); self._st["last_voice"] = ""
        u = self._st["last_user"].lower()   # a worker's voice answers a question only from delegate_task (#28: "Let me pull that up", "The timer is 30 seconds")
        if self._relay and u.rstrip().endswith("?") and not re.search(r"\b(donna|bye)\b", u): return True
        return bool(CLAIM.search(v)) or ((self._relay or bool(ASKED.search(self._st["last_user"].lower()))) and bool(OFFER.search(v)))

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
    assert all(CLAIM.search(x) for x in ("i've handed that task off", "i've handed off the task", "i'm handing off the request", "got it. i'll have the agent take a look"))
    assert ASKED.search("make me a page") and OFFER.search("i'll create it for you")
    assert all(OFFER.search(x) for x in ("sure. could you please provide more details about what the diagram should show?", "i'm not sure what \"this\" refers to. could you clarify?", "i can help with that, but i need a bit more detail.", "could you clarify what you're referring to?"))   # #43
    assert ASKED.search("can you put this into a slide?") and not any(OFFER.search(x) for x in ("sorry, could you say that again?", "sorry, could you clarify that?", "should the page be blue or green?"))
    assert REPLACING.search("Write a poem about dogs, replacing the previous task") and not REPLACING.search("replace the previous header in index.html")
    assert all(OFFER.search(x) for x in ("i can't create files myself, but i can delegate that. shall i set that up?", "shall i set that up?",
                                         "want me to delegate that?", "would you like me to hand that off?")) and not OFFER.search("sure, what else?")
    assert all(OFFER.search(x) for x in ("sure, i can draft a hero section for a tech company. what vibe are we going for?",   # the Oct 24 call, verbatim
                                         "i'll whip up a hero section with a clean layout", "let me put that together",
                                         "sure. i'll add a hero section to the page with a big heading")) and CLAIM.search("i'm putting together the hero section")
    assert all(ASKED.search(x) for x in ("can you tell them to plan a nice hero section", "add a sleek hero section to it", "update the colors"))
    assert not any(ASKED.search(x) for x in ("are you done? like.", "any update on that?", "do you have it yet?", "hello", "who are you?"))
    assert fabricated("I've sent that off to check who built the quiz.") is None   # the question's own words, not a claim (#28 run)
    assert OFFER.search("i'll connect you with maya right now.") and ASKED.search("get me on the line with her.")   # #28 run: no call, no nudge before
    assert all(CLAIM.search(x) for x in ("i'm reaching out to maya now to get you connected.", "i'm connecting you with maya now."))   # #28: no call made
    assert all(ASKED.search(x) for x in ("who built the quiz?", "who's working on the login page?", "get me on the line with her.", "can i talk to maya?"))   # #28
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
    for user, voice, nudged, asked in (("are you done? like.", "on it, just a sec while that updates.", False, False),
                                       ("add a sleek hero section to it", "i'll whip up a hero section with a clean layout.", True, False),
                                       ("make me a page", "could you tell me what colour you'd like, blue or green?", False, True)):   # relaying a worker's ask (#43: interview words are OFFER)
        sent.clear(); c._st.update(last_user=user, last_voice=voice, guarded=False, turn_delegated=False, asked=asked)
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
    STILL_WORKING_AT = 0.05   # two tasks running: one "still working" note, not one each (#36 probe: three tasks, three identical lines)
    c = Conn(None, 24000); c._pending = {"d1", "d2"}
    async def two(): await asyncio.gather(c._still_working("d1"), c._still_working("d2"))
    asyncio.run(two()); assert c._spoken.qsize() == 1
    c = Conn(None, 24000); c._pending = {"d3"}   # the user spoke while it waited: no note (they are not waiting in silence)
    async def spoke(): t = asyncio.create_task(c._still_working("d3")); await asyncio.sleep(0.01); c._st["user_at"] = time.monotonic(); await t
    asyncio.run(spoke()); assert c._spoken.empty()
    with tempfile.TemporaryDirectory() as tmp:   # per-task records: in progress, queued, needs_you, failed; ring mode's duplicate `sent` is skipped
        os.environ["HIGGS_HOME"], h = tmp, Path(tmp) / "herd"
        for name, st in (("ann", {"state": "working", "tasks": {"t1": {"state": "in_progress", "task": "build x", "ts": now - 125},
                                                                   "t2": {"state": "queued", "task": "task two", "ts": now}, "t3": {"state": "queued", "task": "task three", "ts": now}}}),
                         ("bob", {"state": "needs_you", "tasks": {"t4": {"state": "needs_you", "task": "pick a theme", "asked": "light or dark?", "ts": now}}}),
                         ("cy", {"state": "idle", "tasks": {"t5": {"state": "failed", "task": "zip it", "ts": now}, "t6": {"state": "done", "task": "old", "ts": now}}})):
            (h / name).mkdir(parents=True); (h / name / "status.json").write_text(json.dumps(st))
        (h / "events.jsonl").write_text(json.dumps({"ts": now - 5, "ev": "task.failed", "agent": "cy", "id": "t5", "text": "disk full"}) + "\n"
                                        + json.dumps({"ts": now - 5, "ev": "task.sent", "agent": "cy", "id": "t5", "task": "zip it"}) + "\n")
        s = status_summary(now - 30, [("build x", now - 125, False), ("open the page", now - 5, False)], now)
        assert "ann has been working on build x for 2 minutes." in s and "2 tasks waiting in ann's queue: task two, task three." in s, s
        assert "bob is waiting for your answer on pick a theme: light or dark?" in s and "cy could not finish zip it: disk full" in s, s
        assert "cy is idle." in s and "old" not in s and s.count("build x") == 1 and "open the page, has been running" in s, s
        (Path(tmp) / "office.json").write_text(json.dumps({"workers": [{"name": "Donna", "status": "done", "lead": True}, {"name": "Ava", "role": "Writes the page", "status": "working"},
            {"name": "Bob", "status": "done"}, {"name": "Cy", "status": "failed"}], "briefings": [{"id": "t6", "summary": "Zipped.", "status": "queued"}, {"id": "t9", "summary": "Old news.", "status": "presented"}]}))
        with open(h / "events.jsonl", "a") as f: f.write(json.dumps({"ts": now - 5, "ev": "task.done", "agent": "cy", "id": "t6", "text": "Zipped."}) + "\n")
        s = status_summary(now - 30, (), now)   # #43: the office first (workers by status, results not heard), and a told result is not "finished" again
        assert s.startswith("3 workers this session: working: Ava (Writes the page); finished, resting in the lounge: Bob, Cy. Not told to the user yet: Zipped.") and "Old news" not in s, s
        assert "cy could not finish zip it" in s and "cy finished" not in s and s.count("Zipped") == 1 and "Donna" not in s, s
        (h / "ann" / "status.json").write_text(json.dumps({"state": "needs_you", "tasks": {"t7": {"state": "needs_you", "task": "Pick a theme.", "asked": "Light or dark?", "ts": now}, "t8": {"state": "queued", "task": "Add a quiz.", "ts": now}}}))
        assert "ann is waiting for your answer on Pick a theme: Light or dark?" in (s := status_summary(now, (), now)) and "ann's queue: Add a quiz." in s, s   # no ".:" or ".."
        (h / "cy" / "meta.json").write_text(json.dumps({"since": now - 100}))   # #43: what was done earlier in this duty period, before this call
        assert "Done for cy earlier this session: old." in (s := status_summary(now + 1, (), now + 1)) and "zip it" not in s.split("Done for cy")[1], s
        assert "Done for cy" not in status_summary(now - 30, (), now)   # done during this call: reported as finished, not as earlier
        (h / "cy" / "meta.json").write_text(json.dumps({"since": now + 0.5})); assert "Done for cy" not in status_summary(now + 1, (), now + 1)   # an earlier duty period
    # the speech policy: no network, `rec` plays the server's item.added ack
    def mk():
        c, sent = Conn(None, 24000), []
        async def rec(ev):
            sent.append(ev)
            if ev["type"] == "conversation.item.create": [x.set() for x in (c._st["added"], c._st["att"]) if x]
        c._send, c._open, now = rec, {"d1"}, time.monotonic()
        return c, sent, now
    kinds = lambda sent: [e.get("item", {}).get("type") or e["type"] for e in sent]
    async def hold():   # a voice question is open: the result is held, then rides in before the user's typed answer
        c, sent, now = mk(); c._st.update(question=True, user_at=now - 10, voice_at=now - 10); t = asyncio.create_task(c._speak_loop())
        await c.session.commentary.append(content="Done.", delegation_id="d1"); await asyncio.sleep(0.5); assert sent == [], sent
        await c.input_text.append("blue"); t.cancel()
        assert kinds(sent) == ["function_call_output", "message", "response.create"] and sent[1]["item"]["content"][0]["text"] == "blue", sent
    async def quiet():  # 3 s of quiet and no question: out within ~0.3 s; a failure reads as such
        out = []
        for kind, want in (("say", "Done."), ("fail", "The task failed: disk full")):
            c, sent, now = mk(); c._st.update(user_at=now - 3.0, voice_at=now - 3.0); t = asyncio.create_task(c._speak_loop())
            await c.session.commentary.append(content="disk full" if kind == "fail" else want, delegation_id="d1", kind=kind); await asyncio.sleep(0.3); t.cancel()
            assert kinds(sent) == ["function_call_output", "message", "response.create"] and sent[0]["item"]["output"] == want, sent
    async def ask():    # an ask jumps ahead of the held result and leaves the question flag up
        c, sent, now = mk(); c._st.update(question=True, user_at=now - 10, voice_at=now - 10); t = asyncio.create_task(c._speak_loop())
        await c.session.commentary.append(content="Done.", delegation_id="d1"); await c.session.commentary.append(content="light or dark?", delegation_id="d1", kind="ask")
        await asyncio.sleep(0.3); assert kinds(sent) == ["message", "response.create"] and "light or dark?" in sent[0]["item"]["content"][0]["text"] and c._st["question"], sent
        c._st["in_flight"] = False; await c.input_text.append("dark"); t.cancel()
        assert kinds(sent) == ["message", "response.create", "function_call_output", "message", "response.create"], sent
    async def closer():  # a stock closer is not an open question: the result goes out after the quiet beat; a real question holds it
        for voice, held in (("Hey, how's it going?", False), ("How can I help you today?", False), ("Sure! Anything else I can do for you?", False),
                            ("Should the page be blue or green?", True), ("Which folder do you want it in?", True)):
            c, sent, now = mk(); c._st.update(user_at=now - 10, voice_at=now - 10)
            await c._handle({"type": "response.output_audio_transcript.done", "transcript": voice}); assert c._st["question"] == held, voice
        c, sent, now = mk(); c._st.update(user_at=now - 10, voice_at=now - 10, asked=True)   # an ask stays open whatever the voice's wording
        await c._handle({"type": "response.output_audio_transcript.done", "transcript": "Blue or green?"}); assert c._st["question"]
    async def cap():    # HOLD_MAX / QUESTION_MAX: the user never answers, the result goes out on its own
        global HOLD_MAX, QUESTION_MAX
        HOLD_MAX, QUESTION_MAX = 0.3, 10   # the general cap
        try:
            c, sent, now = mk(); c._st.update(user_at=now - 1, voice_at=now - 10); t = asyncio.create_task(c._speak_loop())
            await c.session.commentary.append(content="Done.", delegation_id="d1"); await asyncio.sleep(0.6); t.cancel()
            assert kinds(sent) == ["function_call_output", "message", "response.create"], sent
            HOLD_MAX, QUESTION_MAX = 10, 0.3   # a real question nobody answers: released at QUESTION_MAX, long before HOLD_MAX
            c, sent, now = mk(); c._st.update(question=True, user_at=now - 10, voice_at=now - 10); t = asyncio.create_task(c._speak_loop())
            await c.session.commentary.append(content="Done.", delegation_id="d1"); await asyncio.sleep(0.15); assert sent == [], sent
            await asyncio.sleep(0.45); t.cancel(); assert kinds(sent) == ["function_call_output", "message", "response.create"], sent
        finally: HOLD_MAX, QUESTION_MAX = 10, 6
    async def stale():   # a correction: the replaced call is closed with STALE at once (no response.create), its late result is dropped unspoken
        c, sent, now = mk(); c._st.update(user_at=now - 10, voice_at=now - 10); t = asyncio.create_task(c._speak_loop())
        c._open, c._pending, c._sent, got = {"d1"}, {"d1"}, {"d1": ("blue page", time.time())}, []
        await c._handle({"type": "response.done", "response": {"output": [{"type": "message", "content": [{"transcript": "Green it is."}]},
            {"type": "function_call", "name": TOOL, "call_id": "d2", "arguments": '{"task": "green page", "replaces": true}'}]}})
        assert kinds(sent) == ["function_call_output"] and sent[0]["item"] == {"type": "function_call_output", "call_id": "d1", "output": STALE}, sent
        while not c._out.empty(): got.append(c._out.get_nowait())
        assert [e.delegation.replaces for e in got if e.type == "session.delegation.created"] == ["d1"] and c._pending == {"d2"} and "d1" not in c._sent
        sent.clear(); await c.session.commentary.append(content="Blue page done.", delegation_id="d1"); await asyncio.sleep(0.3); assert sent == [], sent
        assert c._out.get_nowait().kind == "dropped"   # the bridge still hears that the old delegation ended
        c._st["voice_at"] -= 10; await c.session.commentary.append(content="Green page done.", delegation_id="d2"); await asyncio.sleep(0.3); t.cancel()
        assert kinds(sent) == ["function_call_output", "message", "response.create"] and sent[0]["item"]["call_id"] == "d2", sent
    assert fabricated("[NOTE: task finished: added version flag to tool script] Hanging up now.") == PENDING_LINE + " Hanging up now."   # the Oct 24 rehearsal
    assert fabricated("You're welcome! The version flag has been added to the script. Hanging up now.") == f"You're welcome! {PENDING_LINE} Hanging up now."
    assert fabricated('[{"id": "t1", "status": "completed"}] The flag is all set. Hanging up now.') == PENDING_LINE + " Hanging up now."
    assert fabricated("You're all set, notes folder backed up. Hanging up now.") == f"{PENDING_LINE} Hanging up now."   # fake_donna demo, Oct 24
    assert not any(fabricated(x) for x in (PENDING_LINE, "Okay, I'll call you back with the result. Hanging up now.", "You're all set! I'll call you back once it's done.",
                                           "Alright, we're done here. Hanging up now.", "The version flag is being added right now.", "I'll get that version flag added.", "It's still working on that flag.",
                                           "Got it, adding a version flag now.", "Is it ready yet?", "Sure, I've handed that off. I'll let you know when it's ready."))
    async def fab():   # pending, nothing back: the reply is dropped unplayed and the voice is told to say the fixed line; a second one is fixed in text
        c, sent, now = mk(); c.delegation, c._pending = True, {"d1"}
        await c._handle({"type": "response.output_audio_transcript.done", "transcript": "[NOTE: task finished] Hanging up now."})
        await c._handle({"type": "response.done", "response": {"output": []}})
        outs = lambda: [e for e in (c._out.get_nowait() for _ in range(c._out.qsize())) if e.type != "raw"]
        assert [e.type for e in outs()] == ["session.output_audio.discard"] and kinds(sent) == ["message", "response.create"], sent
        assert sent[0]["item"]["content"][0]["text"] == FIX.format(PENDING_LINE + " Hanging up now."), sent
        await c._handle({"type": "response.output_audio_transcript.done", "transcript": "All done. Hanging up now."})
        assert [e.transcript for e in outs()] == [PENDING_LINE + " Hanging up now."]
        c._st["guarded"], c._relay = False, True   # a worker's voice (#28): no result guard; a question answered without delegate_task is nudged
        c._st.update(last_user="how long is the timer?", last_voice="let me pull that up."); assert c._fake_claim()
        c._st.update(last_user="can you put donna back?", last_voice="sure."); assert not c._fake_claim()
        await c._handle({"type": "response.output_audio_transcript.done", "transcript": "I built it."}); assert [e.transcript for e in outs() if e.type == "session.output_transcript.done"] == ["I built it."]
        c._relay = False
        c._done("d2", "say"); c._st["guarded"] = False   # a result went in this turn (d1 still runs): "all done" may be true
        await c._handle({"type": "response.output_audio_transcript.done", "transcript": "All done."}); assert [e.transcript for e in outs() if e.type == "session.output_transcript.done"] == ["All done."]
    async def rep():   # the same line twice while a task runs: the second answer to a user's turn is dropped unplayed and retried once with REPEAT
        c, sent, now = mk(); c.delegation, c._pending = True, {"d1"}
        outs = lambda: [e.type for e in (c._out.get_nowait() for _ in range(c._out.qsize())) if e.type != "raw"]
        async def reply(text, user):
            if user: c._st.update(user_at=time.monotonic(), guarded=False)
            await c._handle({"type": "response.output_audio_transcript.done", "transcript": text}); await c._handle({"type": "response.done", "response": {"output": []}})
            return outs()
        assert await reply("Still working on that website for you.", True) == ["session.output_transcript.done", "response.done"] and sent == []
        assert await reply("Ha, it has. Still working on that website for you!", True) == ["session.output_transcript.done", "response.done"]   # partly new: heard
        assert await reply("Still working on that website for you.", True) == ["session.output_audio.discard"] and kinds(sent) == ["message", "response.create"]
        assert sent[0]["item"]["content"][0]["text"] == REPEAT.format("Still working on that website for you.") and c._st["in_flight"]
        assert await reply("Still working on that website for you.", False) == ["session.output_transcript.done", "response.done"]   # the retry repeats: heard, one retry per turn
        sent.clear(); assert await reply("Still working on that website for you.", False) == ["session.output_audio.discard", "response.done"] and sent == []   # already answered this turn: dropped, no retry
        c._st.update(last_user="also compile a plan for the team"); await reply("I'm on it.", True)   # "I'm on it." again to a new request: GUARD's nudge, which gets the call made
        assert await reply("I'm on it.", True) == ["session.output_audio.discard"] and sent[-2]["item"]["content"][0]["text"] == NUDGE, sent
        c._st.update(last_user=""); await reply("Still just me on this one.", True); c._st.update(user_at=time.monotonic(), guarded=True)   # next turn: a task_status answer runs guarded
        assert await reply("Still just me on this one.", False) == ["session.output_audio.discard"] and sent[-2]["item"]["content"][0]["text"] == REPEAT.format("Still just me on this one."), sent
        c._st.update(guarded=False, last_user=""); sent.clear()
        assert await reply(PENDING_LINE, True) == await reply(PENDING_LINE, True) == ["session.output_transcript.done", "response.done"] and sent == []   # the guard's own line
        await c._attach(("[note] still in progress; tell the user.", None, "d1", "say"), True); assert sent == [] and c._out.empty()   # a still-working note never rides on the user's turn
    async def told():   # #55: the result for "music" went in, then the user's "Thanks, bye": the goodbye may report it, not the running "notes"
        c, sent, now = mk(); c.delegation, c._open, c._pending = True, {"d1", "d2"}, {"d1", "d2"}
        c._sent = {"d1": ("Also zip the music folder.", time.time()), "d2": ("And make a backup of the notes folder.", time.time())}
        outs = lambda: [(e.type, getattr(e, "transcript", "")) for e in (c._out.get_nowait() for _ in range(c._out.qsize())) if e.type != "raw"]
        say = lambda v: c._handle({"type": "response.output_audio_transcript.done", "transcript": v})
        c._st["heard_at"] = time.monotonic(); await c.session.commentary.append(content="Done.", delegation_id="d1")
        text, did, _, kind = c._spoken.get_nowait(); items = c._items(text, did, cue=True); c._done(did, kind); outs()
        assert items[0] == {"type": "function_call_output", "call_id": "d1", "output": 'Result for "Also zip the music folder.": Done.'} and len(items) == 2, items
        await c.input_text.append("Thanks, bye"); assert not c._st["fresh"]   # the user's turn: before #55 the guard swapped a true claim here
        for v in ("All done!", "The music folder zip is all set. Hanging up now."):   # unnamed: the reply right after the result; named: any time
            await say(v); assert outs() == [("session.output_transcript.done", v)], v
        await say("The notes backup is done too. Bye!"); assert outs() == [("session.output_audio.discard", "")]   # names the running task
        await say("Everything's done. Take care."); assert outs() == [("session.output_transcript.done", f"{PENDING_LINE} Take care.")]   # unnamed, a reply later
        c, sent, now = mk(); c.delegation, c._pending, c._sent = True, {"d1", "d2"}, {"d1": ("Also zip the music folder.", 0), "d2": ("And make a backup of the notes folder.", 0)}
        await c._handle({"type": "response.output_audio_transcript.done", "transcript": "The music folder zip is all set. Hanging up now."})   # control: no result came in
        assert [e.type for e in (c._out.get_nowait() for _ in range(c._out.qsize()))] == ["session.output_audio.discard"]
    async def policy(): await asyncio.gather(hold(), quiet(), ask(), closer(), stale(), fab(), rep(), told()); await cap()   # cap flips globals: not alongside the others
    STILL_WORKING_AT = 25   # stale() opens a delegation: no "still working" note inside the test
    t0 = time.monotonic(); asyncio.run(policy()); assert time.monotonic() - t0 < 3
    print("ok")
