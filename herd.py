# /// script
# dependencies = []
# ///
"""herd: a file-based registry/mailbox for agents. Stdlib only.

    uv run herd.py new donna --project .       # register an agent
    uv run herd.py send donna "fix the bug"    # prints the task id
    uv run herd.py send donna "blue" --reply-to <id>  # the person's answer to an ask (not a new task)
    uv run herd.py reply donna <id> take ""          # started: queued -> in progress
    uv run herd.py reply donna <id> note "looking"   # silent progress
    uv run herd.py reply donna <id> ask "blue or green?"  # needs the person: spoken at once
    uv run herd.py reply donna <id> say "done"       # spoken result, task done
    uv run herd.py reply donna <id> fail "could not" # spoken failure, task failed
    uv run herd.py ls | capture donna | state donna working | close donna
    uv run herd.py hook <Event>                # Claude Code hook (hooks/office.json): reads the hook JSON on stdin
    uv run herd.py                             # self-check (temp dir, never touches ~/.higgs)

Layout under $HIGGS_HOME/herd (HIGGS_HOME defaults to ~/.higgs): events.jsonl (append-only log) and
<name>/{meta.json,status.json,inbox.jsonl,outbox.jsonl}. JSONL = one appended line; JSON = atomic replace.
The hook adds $HIGGS_HOME/events.jsonl (every hook event) and $HIGGS_HOME/office.json (docs/office-state.md).
Imports stay light (no argparse/tempfile/uuid at the top): the hook runs after every tool call.
"""
import json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("HIGGS_HOME") or Path.home() / ".higgs")


def root() -> Path:  # resolved per call so tests can set HIGGS_HOME
    return home() / "herd"


def die(msg):
    sys.exit(f"herd: {msg}")


def append(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(obj) + "\n")


def lines(path, n=None):
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []
    return rows[-n:] if n else rows


def write_json(path, obj):
    tmp = path.with_name(f".{path.name}.{os.urandom(4).hex()}")  # not tempfile: that import alone is ~20 ms and this runs in the hook
    tmp.write_text(json.dumps(obj))
    os.replace(tmp, path)


def event(ev, agent, **extra):
    append(root() / "events.jsonl", {"ts": time.time(), "ev": ev, "agent": agent, **extra})


def check_name(name):  # keeps names inside the herd dir
    if not name.replace("-", "").replace("_", "").isalnum():
        die(f"bad agent name: {name!r}")
    return root() / name


def agent_dir(name):
    d = check_name(name)
    if not (d / "meta.json").exists():
        die(f"no such agent: {name}")
    return d


def update(d, **kw):  # merge into status.json
    s = json.loads((d / "status.json").read_text())
    s.update(kw)
    write_json(d / "status.json", s)
    return s


def new(name, kind="session", project=None):
    d = check_name(name)
    if (d / "meta.json").exists():  # /call runs `new donna` on every start
        print(f"herd: {name} exists", file=sys.stderr)
        m = json.loads((d / "meta.json").read_text())
        if project:  # the session may have moved: the project is updated and the old brain session forgotten (the hook records the new one right after this command)
            m = {**{k: v for k, v in m.items() if k != "session"}, "project": str(Path(project).resolve())}
        write_json(d / "meta.json", {**m, "since": time.time()})  # a new duty period: office() shows only what came after
        return
    d.mkdir(parents=True, exist_ok=True)
    ts = time.time()
    write_json(d / "meta.json", {"name": name, "kind": kind, "project": str(Path(project or ".").resolve()),
                                 "parent": None, "created": ts, "since": ts})
    write_json(d / "status.json", {"state": "starting", "task_id": None, "task": None, "last_note": None,
                                   "started": ts, "unread": 0, "tasks": {}})
    event("agent.new", name, kind=kind, parent=None)


def ls():
    out = []
    for m in sorted(root().glob("*/meta.json")):
        meta, st = json.loads(m.read_text()), json.loads((m.parent / "status.json").read_text())
        out.append({**meta, **st})
    return out


def settle(d, name, s, ev, **kw):  # write status with the agent state from the task states, then the event, then agent.state if it changed
    sts = [t["state"] for t in s["tasks"].values()]
    new = "needs_you" if "needs_you" in sts else "working" if "in_progress" in sts else "idle"
    write_json(d / "status.json", {**s, "state": new})
    event(ev, name, **kw)
    if new != s["state"]:
        event("agent.state", name, state=new)


def load(d):  # status.json, tasks always present
    s = json.loads((d / "status.json").read_text())
    s.setdefault("tasks", {})
    return s


def tmux_name():  # the brain's tmux session (bridge.py --brain): "donna" for ~/.higgs, its own name for any other HIGGS_HOME, so tests never type into the real one
    h = home().resolve()
    return "donna" if h == (Path.home() / ".higgs").resolve() else "donna-" + re.sub(r"[^A-Za-z0-9_-]", "-", h.name)


def wake(text):  # #38: an idle brain gets a turn at once: the line is typed into its tmux session, if there is one
    import subprocess
    t = f"={tmux_name()}:"  # "=": exact session name (tmux matches prefixes otherwise)
    try:
        if subprocess.run(["tmux", "has-session", "-t", t], capture_output=True).returncode == 0:
            subprocess.run(["tmux", "send-keys", "-t", t, "-l", " ".join(text.split())[:500]], capture_output=True)
            time.sleep(0.3)  # an Enter right behind the text was taken as part of it and never submitted (Claude Code 2.1.309, 1 of 3)
            subprocess.run(["tmux", "send-keys", "-t", t, "Enter"], capture_output=True)
    except OSError:  # no tmux installed
        pass


def send(name, task, context=None, frm="user", tid=None, reply_to=None, transcript=None, replaces=None, with_=None):  # tid: the caller's id (bridge.py passes the Higgs call_id)
    d = agent_dir(name)
    tid = tid or os.urandom(4).hex()
    line = {"id": tid, "task": task, "context": context, "from": frm, "ts": time.time()}
    if transcript is not None:  # [[role, text], ...] role "user"|"assistant": the call so far, printed by the hook instead of `context`
        line["transcript"] = transcript
    if with_:  # #28: the person is on the line with this worker: the brain forwards the words to them and says their answer
        line["with"] = with_
    if replaces:  # the user corrected task `replaces` on the call: the voice drops its result; the brain fails it and does this one
        line["replaces"] = replaces
    s = load(d)
    if reply_to:  # an answer to an `ask`, not a new task
        append(d / "inbox.jsonl", {**line, "in_reply_to": reply_to})
        if (t := s["tasks"].get(reply_to)) and t["state"] == "needs_you":
            t.update(state="in_progress", ts=time.time()); t.pop("asked", None)
    else:
        append(d / "inbox.jsonl", line)
        s["tasks"][tid] = {"state": "queued", "task": task, "ts": time.time()}
    if not reply_to:  # an answer is not a task: no unread, no task_id/task overwrite
        s.update(unread=s["unread"] + 1, task_id=tid, task=task)
    settle(d, name, s, "task.sent", id=tid, task=task, **{"from": frm}, **({"in_reply_to": reply_to} if reply_to else {}))
    if name == "donna":
        wake(f"Answer to task {reply_to}: {task}" if reply_to else f"Phone task {tid}" + (f" (on the line with {with_})" if with_ else "") + f": {task}")
    return tid


def capture(name):
    d = agent_dir(name)
    return {**load(d), "outbox": lines(d / "outbox.jsonl", 3)}


def close(name):
    update(agent_dir(name), state="dead")
    event("agent.close", name)


def state(name, st):
    update(agent_dir(name), state=st)
    event("agent.state", name, state=st)


EV = {"take": "task.taken", "ask": "task.needs_you", "say": "task.done", "fail": "task.failed", "transfer": "task.transfer"}


def reply(name, tid, kind, text):  # take|note|ask|say|fail|transfer (text: the worker's name, #28); an illegal transition dies before writing anything
    d = agent_dir(name)
    s = load(d)
    t = s["tasks"].get(tid)
    st = t["state"] if t else "unknown"
    if kind != "note" and st in ("done", "failed"):
        die(f"task {tid} is already {st}")
    if kind == "take" and st in ("in_progress", "needs_you"):
        return
    append(d / "outbox.jsonl", {"id": tid, "kind": kind, "text": text, "ts": time.time()})
    if kind == "note":
        s["last_note"] = text
    else:
        t = s["tasks"][tid] = {**(t or {"task": None}), "ts": time.time(),
                               "state": {"take": "in_progress", "ask": "needs_you", "say": "done", "fail": "failed", "transfer": "done"}[kind]}
        t.pop("asked", None)
        if kind == "ask":
            t["asked"] = text
        if kind in ("say", "fail", "transfer"):
            s["unread"] = max(0, s["unread"] - 1)
            old = [k for k, v in s["tasks"].items() if v["state"] in ("done", "failed")]
            for k in old[:max(0, len(s["tasks"]) - 50)]:
                del s["tasks"][k]  # oldest finished first (dict order), keeps tasks small
    settle(d, name, s, EV.get(kind, "task.note"), id=tid, text=text)


# ---- brain-side hook + office.json (docs/office-state.md) ----------------------------------------------------------
# `herd.py hook <Event>` is registered for SubagentStart/SubagentStop/PostToolUse/UserPromptSubmit/Stop/Notification
# (hooks/office.json). Every event is appended to $HIGGS_HOME/events.jsonl and office.json is re-rendered from the files.

TAIL = 1 << 20  # ponytail: office() reads only the last 1 MB of each events file (~3000 hook events). $HIGGS_HOME/events.jsonl is shared by EVERY Claude Code session with the hook installed, so a busy fleet can push a running agent's SubagentStart out of the window and its row vanishes. Upgrade: filter at log time by the registered session, or one file per session
KEYS = ["char-male-b", "char-female-d", "char-male-a", "char-female-e", "char-male-d"]  # worker looks, by order of first appearance
VOICES = {"female": ["chloe", "eleanor", "nora"], "male": ["jake", "marcus", "oliver"]}  # #28: by the look's gender, round-robin; nora last: Donna is nora


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def tail(path, n=TAIL):  # dict rows parsed from the last n bytes of a JSONL file; a cut or half-written line is skipped
    try:
        with open(path, "rb") as f:
            size = f.seek(0, 2)
            f.seek(max(0, size - n))
            b = f.read()
    except OSError:
        return []
    rows = []
    for l in b.decode("utf-8", "replace").split("\n")[1 if size > n else 0:]:  # the first line is cut when we did not start at 0
        try: rows.append(json.loads(l))
        except ValueError: pass
    return [r for r in rows if isinstance(r, dict)]


def rj(path):  # tolerant JSON read: other processes write these files
    try: d = json.loads(path.read_text())
    except (OSError, ValueError): return {}
    return d if isinstance(d, dict) else {}


def text_of(x):  # a tool_response's text: a str, {content|result|text: str | [{text}]}, or [{text}]
    if isinstance(x, dict): x = x.get("content") or x.get("result") or x.get("text") or ""
    if isinstance(x, list): x = "\n".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in x)
    return x if isinstance(x, str) else ""


def trim(tool, inp):  # scalars only, strings cut: an Agent call keeps name/description/prompt, a handback keeps its report
    big = {("Agent", "prompt"): 4000, ("SubagentHandback", "message"): 1500}
    return {k: v[:big.get((tool, k), 200)] if isinstance(v, str) else v
            for k in (("name", "description", "prompt") if tool == "Agent" else inp) if isinstance(v := inp.get(k), (str, int, float, bool))}


def action(e):  # a PostToolUse event (or None) -> "Read dash.py", "Bash ls"
    if not e: return ""
    tool, inp = e.get("tool"), e.get("input") or {}
    arg = os.path.basename(inp["file_path"]) if tool in ("Read", "Write", "Edit") and inp.get("file_path") else \
        next((" ".join(str(inp[k]).split()) for k in ("command", "pattern", "path", "description", "url") if inp.get(k)), "")
    return f"{tool} {arg[:50]}".strip()


def log_event(ev, d):  # (a)
    tool, inp, resp = d.get("tool_name"), d.get("tool_input"), d.get("tool_response")
    inp, async_ = inp if isinstance(inp, dict) else {}, isinstance(resp, dict) and resp.get("status") == "async_launched"
    r = {"ts": time.time(), "ev": ev, "session": d.get("session_id"), "agent": d.get("agent_id"), "type": d.get("agent_type"),
         "cwd": d.get("cwd"), "tool": tool, "input": trim(tool, inp) or None,
         "agentId": resp.get("agentId") if isinstance(resp, dict) else None,
         # a foreground Agent's PostToolUse arrives after it finished and carries its result ("" is still a result: it marks done)
         "result": text_of(resp)[:1500] if ev == "PostToolUse" and tool == "Agent" and not async_ else None,
         "prompt": (d.get("prompt") or "")[:300] or None if ev == "UserPromptSubmit" else None}
    append(home() / "events.jsonl", {k: v for k, v in r.items() if v is not None})


def register(ev, d):  # (b) the brain runs /call step 1 (`herd.py new donna`): remember which session it is
    if ev == "PostToolUse" and not d.get("agent_id") and d.get("tool_name") == "Bash" and "herd.py new donna" in str((d.get("tool_input") or {}).get("command")):
        p = root() / "donna" / "meta.json"
        if p.exists(): write_json(p, {**json.loads(p.read_text()), "session": d["session_id"]})


def brain(d):  # the hook input is the registered brain's own (not a subagent's, not another session's)
    meta = json.loads((root() / "donna" / "meta.json").read_text())
    if d.get("agent_id"): return False
    if meta.get("session"): return d["session_id"] == meta["session"]
    return os.path.realpath(d["cwd"]) == os.path.realpath(meta["project"])  # no session registered yet: match the project dir


def inject(ev, d):  # (c) a busy Donna (mid-task) gets new inbox lines as hook context; only the brain's own tool calls may consume them
    if ev != "PostToolUse" or not brain(d): return
    dd = root() / "donna"
    off = dd / ".hook_offset"
    o = int(off.read_text()) if off.exists() else 0
    with open(dd / "inbox.jsonl", "rb") as f:
        f.seek(o); data = f.read()
    data = data[:data.rfind(b"\n") + 1]  # complete lines only
    if not data: return
    off.write_text(str(o + len(data)))
    msgs = []
    for line in data.splitlines():
        try: m = json.loads(line)
        except ValueError: continue
        r = f"uv run -q {os.path.abspath(__file__)} reply donna {m['id']}"
        if m.get("in_reply_to"): msgs.append(f"Answer to task {m['in_reply_to']}: {m['task']}"); continue
        ctx = "\n".join(f"{role}: {text}" for role, text in m["transcript"][-12:]) if m.get("transcript") else f"Context: {m.get('context') or '(none)'}"
        if m.get("replaces"):  # the user corrected an earlier task on the call
            ctx += f"\nThis corrects task {m['replaces']}: stop that one and close it with: uv run -q {os.path.abspath(__file__)} reply donna {m['replaces']} fail \"Replaced by the corrected request.\""
        if m.get("with"):  # #28: a transfer turn
            ctx += f"\nThe person is on the line with {m['with']}: forward their words to {m['with']} (SendMessage) and say {m['with']}'s answer, in first person."
        msgs.append(f"Phone task {m['id']}: {m['task']}\n{ctx}\nFirst: {r} take \"\"; progress: {r} note \"…\"; "
                    f"a decision you need from the person: {r} ask \"…\" (the answer arrives as an inbox line with in_reply_to); "
                    f"when done: {r} say \"…\" (≤3 plain sentences) or {r} fail \"…\".")
    if msgs: return json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "\n\n".join(msgs)}})


def stop_block(ev, d):  # (d) #38: the brain may not go idle while phone lines sit past the wait loop's .offset (its loop died: nothing would wake it)
    if ev != "Stop" or d.get("stop_hook_active") or not brain(d): return  # stop_hook_active: it already got one block for this stop
    dd = root() / "donna"
    with open(dd / "inbox.jsonl", "rb") as f:
        f.seek(int((dd / ".offset").read_text())); data = f.read()
    waiting = []
    for line in data[:data.rfind(b"\n") + 1].splitlines():
        try: m = json.loads(line)
        except ValueError: continue
        waiting.append(f"answer to task {m['in_reply_to']}: {m['task'][:80]}" if m.get("in_reply_to") else f"{m['id']}: {m['task'][:80].rstrip('.')}")
    if waiting:
        return json.dumps({"decision": "block", "reason": f"Phone task(s) waiting: {'; '.join(waiting)}. Handle them (skill step 3), then run the wait loop again."})


def hook(event, data=None):  # never raises, prints only (c) and (d)
    try: d = data if data is not None else json.load(sys.stdin)
    except Exception: return
    for step in (log_event, register, inject, stop_block, lambda ev, d: write_office()):  # one failing step must not skip the rest
        try:
            if isinstance(out := step(event, d), str): print(out)
        except Exception: pass


def office(now=None):
    now = time.time() if now is None else now
    h, dd = home(), root() / "donna"
    meta, st = rj(dd / "meta.json"), rj(dd / "status.json")
    proj = meta.get("project") or ""
    pid = re.sub(r"[^A-Za-z0-9]", "-", proj)
    since = meta.get("since") or meta.get("created") or 0  # this duty period: since the last `herd.py new donna` (#31)
    inbox, outbox = tail(dd / "inbox.jsonl"), tail(dd / "outbox.jsonl")
    says = [o for o in outbox if o.get("kind") == "say" and (o.get("ts") or 0) >= since][-10:]
    hev, evs = tail(root() / "events.jsonl"), tail(h / "events.jsonl")
    spoken = {e.get("id") for e in hev if e.get("ev") == "task.spoken"}  # bridge.py: the voice delivered it, on the call or as the ring's opener
    # the brain's session: registered by /call, else the newest brain event fired from the project dir
    sess, real = meta.get("session"), lambda p, c={}: c.get(p) or c.setdefault(p, os.path.realpath(p))
    if not sess and proj:
        sess = next((e.get("session") for e in reversed(evs) if not e.get("agent") and e.get("cwd") and real(e["cwd"]) == real(proj)), None)
    evs = [e for e in evs if sess and e.get("session") == sess]  # other sessions fire the hook too
    rows, lead = {}, {"t": 0, "stop": 0, "act": None}  # rows: agent id -> worker/assignment facts, in order of first appearance; act: its last PostToolUse event

    def row(i, e):
        return rows.setdefault(i, {"id": i, "type": None, "name": None, "desc": None, "prompt": "", "act": None, "t0": e.get("ts") or 0, "t1": None,
                                   "fail": False, "summary": None, "cwd": e.get("cwd") or "", "matched": False})

    for e in evs:
        ev, a, tool, inp, ts = e.get("ev"), e.get("agent"), e.get("tool"), e.get("input") or {}, e.get("ts") or 0
        if ev == "SubagentStart" and a: row(a, e)["type"] = e.get("type")
        elif ev == "SubagentStop" and a: r = row(a, e); r["t1"] = r["t1"] or ts  # its background_tasks say "running": ignored
        elif ev == "UserPromptSubmit" and not a: lead["t"] = ts
        elif ev == "Stop" and not a: lead["stop"] = ts
        elif ev == "PostToolUse":
            if a:
                r = row(a, e)
                if tool == "SubagentHandback": r["summary"] = inp.get("message"); r["t1"] = r["t1"] or ts  # the report, not an action: Bob stays "Bash ls"
                else: r["act"] = e
            else:
                lead.update(t=ts, act=e)
            if tool == "Agent":  # names the row; the SubagentStart row came first, so merge by id
                i = e.get("agentId")
                if not i:  # a foreground Agent without an id: the newest row not yet named, preferring one that already stopped
                    un = [r for r in rows.values() if not r["matched"]]
                    i = next((r["id"] for r in reversed(un) if r["t1"]), None) or (un[-1]["id"] if un else f"agent-{len(rows)}")
                r = row(i, e); r.update(matched=True, name=inp.get("name"), desc=inp.get("description"), prompt=inp.get("prompt") or "")
                if "result" in e: r["t1"] = r["t1"] or ts; r["summary"] = e["result"] or r["summary"]  # foreground: done
    if not evs and proj:  # hooks not installed: the workers from the brain's transcript, the way dash.py reads it
        try:
            import dash  # lazy: it imports curses
            sid = dash.find_orch(proj); sess = sess or sid
            ls = sid and dash.read_tail(Path.home() / ".claude" / "projects" / pid / f"{sid}.jsonl")
            for x in dash.parse_transcript(ls or [])["agents"]:
                rows[x["id"]] = {"id": x["id"], "type": None, "name": x["name"], "desc": x["desc"], "prompt": "", "act": None, "t0": x["t0"] or 0,
                                 "t1": x["t1"], "fail": x["fail"], "summary": None, "cwd": proj, "matched": True}
        except Exception: pass
    stt = lambda r: "failed" if r["fail"] else "done" if r["t1"] else "working"
    needs = {k: t for k, t in (st.get("tasks") or {}).items() if t.get("state") == "needs_you" and (t.get("ts") or 0) >= since}
    lid = f"brain-{sess[:8]}" if sess else "brain"
    workers = [{"id": lid, "projectId": pid, "name": "Donna", "role": "Brain", "responsibility": "", "characterKey": "char-female-b",
                "status": "waiting" if needs else "working" if lead["t"] > lead["stop"] else "done", "assignmentId": "", "currentAction": action(lead["act"]), "lead": True}]
    asg = []
    seen = {"female": 0, "male": 0}
    for n, r in enumerate(rows.values()):
        name, key = r["name"] or r["desc"] or r["type"] or "Agent", KEYS[n % len(KEYS)]
        g = "female" if "female" in key else "male"; seen[g] += 1
        workers.append({"id": r["id"], "projectId": pid, "name": name, "role": r["desc"] or "", "responsibility": "", "characterKey": key,
                        "voice": VOICES[g][(seen[g] - 1) % 3], "status": stt(r), "assignmentId": r["id"], "currentAction": action(r["act"])})
        asg.append({"id": r["id"], "projectId": pid, "workerId": r["id"], "title": r["desc"] or name, "brief": r["prompt"], "acceptance": "", "status": stt(r),
                    "cwd": r["cwd"], **({"summary": r["summary"]} if r["summary"] else {}), "startedAt": iso(r["t0"]), **({"completedAt": iso(r["t1"])} if r["t1"] else {}),
                    "artifacts": [], "dependsOn": [], "revision": 0})
    sent = {e["id"]: e.get("ts") or 0 for e in hev if e.get("ev") == "task.sent" and "id" in e}
    briefings = []
    for o in says:  # contributors: the workers that started between the task and its say; workerId the first of them (the office walks that desk to Donna), else the lead
        ws = [w for w, r in zip(workers[1:], rows.values()) if sent.get(o["id"], 0) <= r["t0"] <= o["ts"]]
        briefings.append({"id": o["id"], "assignmentId": ws[0]["id"] if ws else "", "projectId": pid, "workerId": ws[0]["id"] if ws else lid, "deliveryKey": o["id"],
                          "title": (o.get("text") or "")[:60], "summary": o.get("text") or "", "artifacts": [], "verification": [], "status": "presented" if o["id"] in spoken else "queued",
                          "createdAt": iso(o["ts"]), "contributors": [{"name": w["name"], "title": "", "summary": ""} for w in ws]})
    decisions = [{"id": k, "projectId": pid, "title": t.get("asked") or "", "context": t.get("task") or "", "status": "open",
                  "createdAt": iso(t.get("ts") or 0), "updatedAt": iso(t.get("ts") or 0)} for k, t in needs.items()]
    act = [{"at": iso(e.get("ts") or 0), "projectId": pid,
            "message": (f"{e.get('agent')} {e.get('ev')}" + (f": {x}" if (x := e.get("text") or e.get("task") or e.get("state")) else ""))[:120]}
           for e in [e for e in hev if (e.get("ts") or 0) >= since][-20:]]
    try:  # a crashed bridge must not leave the office "speaking": the state file counts for 3 s
        p = h / "state.json"
        sj = json.loads(p.read_text()) if now - p.stat().st_mtime <= 3 else {}
        call = sj.get("state") or "off"
    except (OSError, ValueError, AttributeError): call, sj = "off", {}
    on = (sj.get("with") or "").lower()  # #28: who the person is talking to, by name (bridge.py); the office gets that worker's id, else "donna"
    with_ = next((w["id"] for w in workers[1:] if w["name"].lower() == on), "donna") if call != "off" and on else None
    prev = rj(h / "office.json").get("revision")
    return {"revision": prev + 1 if isinstance(prev, int) else 0, "call": {"state": call, **({"with": with_} if with_ else {})},
            "secretary": {"id": "mara", "name": "Donna", "role": "Secretary", "voice": "nora", "characterKey": "char-female-b"},
            "projects": [{"id": pid, "name": os.path.basename(proj.rstrip("/")), "goal": next((m.get("task") or "" for m in inbox if not m.get("in_reply_to")), ""),
                          "memory": {"outcome": "", "checkpoint": "", "latest": says[-1].get("text") or "" if says else "", "nextStep": "",
                                     "updatedAt": iso(says[-1]["ts"]) if says else ""}}] if proj else [],
            "workers": workers, "assignments": asg, "decisions": decisions, "briefings": briefings, "activity": act}


def write_office():  # atomic: the office server reads this file while we write it
    home().mkdir(parents=True, exist_ok=True)
    write_json(home() / "office.json", office())


def selfcheck_office():  # the brain-side hook and office.json, replayed from a script modelled on real Claude Code 2.1.309 hook inputs
    import contextlib, io, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["HIGGS_HOME"] = tmp
        H, proj, S, B = Path(tmp), tmp + "/proj", "sess-0123-brain", "a1b2c3bob"
        os.mkdir(proj)
        new("donna", project=proj)  # stores the resolved path (macOS /var -> /private/var): hook cwds below use the unresolved one
        mp, ib, pid = root() / "donna" / "meta.json", root() / "donna" / "inbox.jsonl", re.sub(r"[^A-Za-z0-9]", "-", rj(root() / "donna" / "meta.json")["project"])
        lid = "brain-" + S[:8]

        def fire(ev, sess=S, **k):  # one hook call; returns what it printed
            out = io.StringIO()
            with contextlib.redirect_stdout(out): hook(ev, {"session_id": sess, "cwd": proj, "hook_event_name": ev, **k})
            return out.getvalue()
        O = lambda: json.loads((H / "office.json").read_text())
        W = lambda o, i: next(w for w in o["workers"] if w["id"] == i)
        evs = lambda: [json.loads(l) for l in (H / "events.jsonl").read_text().splitlines()]

        t1 = send("donna", "build the page"); reply("donna", t1, "take", "")
        off = root() / "donna" / ".hook_offset"; off.write_text(str(ib.stat().st_size))  # /call step 1 starts the offset at the end of the inbox
        fire("UserPromptSubmit", prompt="x" * 400)
        assert len(evs()[0]["prompt"]) == 300 and O()["workers"][0]["status"] == "working" and O()["revision"] == 0
        assert fire("PostToolUse", tool_name="Bash", tool_input={"command": f"uv run -q {__file__} new donna --kind session --project {proj}"}, tool_response={}) == ""
        assert rj(mp)["session"] == S and rj(mp)["kind"] == "session"  # registered, other fields kept
        fire("SubagentStart", agent_id=B, agent_type="general-purpose")
        assert (w := W(O(), B))["name"] == "general-purpose" and w["status"] == "working"  # not named yet
        fire("PostToolUse", tool_name="Agent", tool_input={"name": "Bob", "description": "Count files", "prompt": "Run ls", "model": "haiku", "run_in_background": True},
             tool_response={"isAsync": True, "status": "async_launched", "agentId": B})
        fire("PostToolUse", agent_id=B, agent_type="general-purpose", tool_name="Bash", tool_input={"command": "ls", "description": "List files"}, tool_response={"stdout": "a.txt"})
        assert (w := W(O(), B)) | {"characterKey": 0} == {"id": B, "projectId": pid, "name": "Bob", "role": "Count files", "responsibility": "", "characterKey": 0,
                                                          "voice": "jake", "status": "working", "assignmentId": B, "currentAction": "Bash ls"}, w
        assert w["characterKey"] == KEYS[0]
        fire("SubagentStart", sess="other", agent_id="zzz", agent_type="x"); fire("PostToolUse", sess="other", tool_name="Read", tool_input={"file_path": "/a/b.py"})
        fire("Stop", sess="other")  # another session fires the hook from the same dir: its events count for nothing
        fire("PostToolUse", agent_id=B, tool_name="SubagentHandback", tool_input={"message": "Ran ls: 1 file. The answer is 1."}, tool_response={"success": True})
        fire("SubagentStop", agent_id=B, agent_type="general-purpose")  # a real SubagentStop still lists the agent as "running": ignored
        assert O()["workers"][0]["status"] == "working" and W(O(), B)["status"] == "done"  # the brain's turn is still running
        fire("Stop", last_assistant_message="1", background_tasks=[{"id": B, "status": "running"}])
        o = O()
        assert [w["id"] for w in o["workers"]] == [lid, B] and o["workers"][0] == {
            "id": lid, "projectId": pid, "name": "Donna", "role": "Brain", "responsibility": "", "characterKey": "char-female-b", "status": "done",
            "assignmentId": "", "currentAction": "Agent Count files", "lead": True}, o["workers"][0]
        assert len(o["assignments"]) == 1 and (a := o["assignments"][0]) | {"startedAt": 0, "completedAt": 0} == {
            "id": B, "projectId": pid, "workerId": B, "title": "Count files", "brief": "Run ls", "acceptance": "", "status": "done", "cwd": proj,
            "summary": "Ran ls: 1 file. The answer is 1.", "startedAt": 0, "completedAt": 0, "artifacts": [], "dependsOn": [], "revision": 0}, a
        assert a["startedAt"] <= a["completedAt"] and a["startedAt"].endswith("+00:00")
        assert o["secretary"]["characterKey"] == "char-female-b" and o["call"] == {"state": "off"} and o["projects"][0]["goal"] == "build the page"
        e = evs()
        assert e[3]["input"] == {"name": "Bob", "description": "Count files", "prompt": "Run ls"} and e[3]["agentId"] == B and "result" not in e[3] and "agent" not in e[3]
        assert e[4]["agent"] == B and e[4]["input"] == {"command": "ls", "description": "List files"} and e[8]["input"]["message"].startswith("Ran ls")

        reply("donna", t1, "say", "All done, 1 file."); write_office()  # briefing: the workers that started between the task and the say
        assert len(bs := O()["briefings"]) == 1 and bs[0] | {"createdAt": 0} == {
            "id": t1, "assignmentId": B, "projectId": pid, "workerId": B, "deliveryKey": t1, "title": "All done, 1 file.", "summary": "All done, 1 file.", "artifacts": [],
            "verification": [], "status": "queued", "contributors": [{"name": "Bob", "title": "", "summary": ""}], "createdAt": 0}, bs
        assert O()["projects"][0]["memory"]["latest"] == "All done, 1 file." and "donna task.done: All done, 1 file." in [x["message"] for x in O()["activity"]]

        fire("SubagentStart", agent_id="fg1", agent_type="Explore"); fire("SubagentStop", agent_id="fg1", agent_type="Explore")  # foreground Agent: no agentId, the result comes with the PostToolUse
        fire("PostToolUse", tool_name="Agent", tool_input={"description": "Fg job", "prompt": "p"}, tool_response={"status": "completed", "content": [{"type": "text", "text": "found it"}]})
        assert W(O(), B)["currentAction"] == "Bash ls"  # done, and the handback did not replace its last action
        assert (w := W(O(), "fg1"))["name"] == "Fg job" and w["status"] == "done" and w["characterKey"] == KEYS[1]
        assert next(x for x in O()["assignments"] if x["id"] == "fg1")["summary"] == "found it"
        fire("Stop")

        t2 = send("donna", "pick a colour"); reply("donna", t2, "ask", "blue or green?"); write_office()  # an open ask: a decision, and the brain is waiting
        assert O()["decisions"] == [{"id": t2, "projectId": pid, "title": "blue or green?", "context": "pick a colour", "status": "open",
                                     "createdAt": O()["decisions"][0]["createdAt"], "updatedAt": O()["decisions"][0]["createdAt"]}] and O()["workers"][0]["status"] == "waiting"
        send("donna", "blue", reply_to=t2); write_office()
        assert O()["decisions"] == [] and O()["workers"][0]["status"] == "done"

        sp = H / "state.json"; sp.write_text('{"state": "speaking"}')  # bridge.py's state file: fresh counts, stale (crashed bridge) is "off"
        assert office()["call"] == {"state": "speaking"}
        assert [w["voice"] for w in office()["workers"][1:]] == ["jake", "chloe"]  # #28: Bob (male look), the Fg job (female look)
        sp.write_text('{"state": "speaking", "with": "BOB"}'); assert office()["call"] == {"state": "speaking", "with": B}  # put through to Bob: his id
        sp.write_text('{"state": "listening", "with": "Donna"}'); assert office()["call"] == {"state": "listening", "with": "donna"}
        sp.write_text('{"state": "off", "with": "Bob"}'); assert office()["call"] == {"state": "off"}
        sp.write_text('{"state": "speaking"}')
        os.utime(sp, (time.time() - 10,) * 2)
        assert office()["call"] == {"state": "off"}
        sp.write_text("{")
        assert office()["call"] == {"state": "off"}

        write_office(); a = O(); write_office(); b = O()  # idempotent: only the revision moves
        assert b.pop("revision") == a.pop("revision") + 1 and a == b
        m = rj(mp); m.pop("session"); write_json(mp, m)  # no session registered: the brain is the newest no-agent event from the project dir
        assert {k: v for k, v in office().items() if k != "revision"} == b
        write_json(mp, {**m, "session": S})

        off.write_text(str(ib.stat().st_size))  # the earlier lines were seen
        send("donna", "call the plumber", context="ctx", transcript=[["user" if i % 2 == 0 else "assistant", f"line{i:02d}"] for i in range(14)])
        assert "transcript" in lines(ib)[-1] and "transcript" not in lines(ib)[0]
        before = off.read_text()
        assert fire("PostToolUse", agent_id=B, tool_name="Read", tool_input={"file_path": "/a/b.py"}) == "" and off.read_text() == before  # a subagent never consumes the inbox
        assert fire("PostToolUse", sess="other", tool_name="Read", tool_input={"file_path": "/a/b.py"}) == "" and off.read_text() == before
        out = fire("PostToolUse", tool_name="Read", tool_input={"file_path": "/a/b.py"})
        c = json.loads(out)["hookSpecificOutput"]
        assert c["hookEventName"] == "PostToolUse" and out.endswith("\n") and out.count("\n") == 1
        ctx = c["additionalContext"]
        assert "Phone task " in ctx and ": call the plumber" in ctx and "assistant: line13" in ctx and "user: line12" in ctx and "line01" not in ctx and "line02" in ctx
        assert "Context:" not in ctx and "reply donna" in ctx and " take " in ctx and " ask " in ctx and off.read_text() != before
        assert fire("PostToolUse", tool_name="Read", tool_input={"file_path": "/a/b.py"}) == ""  # once
        send("donna", "make it green", tid="g2", transcript=[["user", "actually, make it green"]], replaces="b1")  # a correction names the task it replaces
        assert lines(ib)[-1]["replaces"] == "b1" and 'reply donna b1 fail' in json.loads(fire("PostToolUse", tool_name="Read", tool_input={"file_path": "/a/b.py"}))["hookSpecificOutput"]["additionalContext"]
        send("donna", "how did you do the timer", tid="w1", with_="Maya")  # #28: a turn while the person talks to Maya
        assert lines(ib)[-1]["with"] == "Maya" and "forward their words to Maya (SendMessage)" in json.loads(fire("PostToolUse", tool_name="Read", tool_input={"file_path": "/a/b.py"}))["hookSpecificOutput"]["additionalContext"]
        send("donna", "blue", reply_to=t2)
        assert "Answer to task " + t2 + ": blue" in json.loads(fire("PostToolUse", tool_name="Bash", tool_input={"command": "ls"}))["hookSpecificOutput"]["additionalContext"]
        m = rj(mp); m.pop("session"); write_json(mp, m)  # no session yet: the project dir decides (today's rule)
        send("donna", "water the plants", context="ctx2")
        assert "Context: ctx2" in json.loads(fire("PostToolUse", tool_name="Read", tool_input={"file_path": "/a/b.py"}))["hookSpecificOutput"]["additionalContext"]
        write_json(mp, {**m, "session": S})

        wo = root() / "donna" / ".offset"; wo.write_text(str(ib.stat().st_size))  # #38: the wait loop printed everything: Donna may stop
        assert fire("Stop") == ""
        t5 = send("donna", "fix the login page"); send("donna", "green", reply_to=t2)  # the loop died: these sit past .offset
        r = json.loads(fire("Stop"))
        assert r["decision"] == "block" and f"{t5}: fix the login page" in r["reason"] and f"answer to task {t2}: green" in r["reason"] and "wait loop" in r["reason"], r
        assert fire("Stop", stop_hook_active=True) == "" and fire("Stop", sess="other") == "" and fire("Stop", agent_id=B) == ""  # one block per stop; only the brain
        wo.write_text(str(ib.stat().st_size)); assert fire("Stop") == ""  # the loop ran again
        import shutil, subprocess
        if shutil.which("tmux"):  # send types the task into the brain's tmux session; `cat` stands in for Claude Code
            n = tmux_name(); assert n.startswith("donna-")  # a temp HIGGS_HOME never names the real "donna"
            subprocess.run(["tmux", "new-session", "-d", "-s", n, "cat"], check=True)
            try:
                tid = send("donna", "check   the\nlogs"); time.sleep(0.3)
                pane = subprocess.run(["tmux", "capture-pane", "-p", "-t", f"={n}:"], capture_output=True, text=True).stdout
                assert f"Phone task {tid}: check the logs" in pane, pane
            finally: subprocess.run(["tmux", "kill-session", "-t", f"={n}"])

        so, se = sys.stdin, io.StringIO()  # a hook that fails must never raise or print
        try:
            sys.stdin = io.StringIO("not json")
            with contextlib.redirect_stdout(se): hook("Stop"); hook("PostToolUse", {"tool_input": 5, "session_id": None}); hook("Notification", {})
        finally: sys.stdin = so
        assert se.getvalue() == ""

        t3 = send("donna", "old ask"); reply("donna", t3, "ask", "keep it?"); write_office()  # #31: a new duty period starts clean
        assert O()["briefings"] and O()["decisions"] and O()["activity"]
        time.sleep(0.01); new("donna", project=proj); write_office()
        assert (o := O())["briefings"] == [] and o["decisions"] == [] and o["activity"] == [], o
        t4 = send("donna", "count the files"); reply("donna", t4, "say", "Four files."); write_office()
        assert [(b["id"], b["status"]) for b in O()["briefings"]] == [(t4, "queued")], O()["briefings"]; assert len(O()["activity"]) == 2, O()["activity"]
        event("task.spoken", "donna", id=t4); write_office()  # bridge.py: the voice said it
        assert O()["briefings"][0]["status"] == "presented"
        for i in range(12): reply("donna", f"s{i}", "say", f"result {i}")
        write_office(); assert len(O()["briefings"]) == 10 and O()["briefings"][-1]["summary"] == "result 11"

        if (Path(__file__).parent / "dash.py").exists():  # fallback: no hook events for the brain, workers from its transcript
            (H / "events.jsonl").unlink(); write_json(mp, m)
            tdir = H / ".claude" / "projects" / pid  # HOME is swapped below so dash.find_orch reads this temp dir
            tdir.mkdir(parents=True)
            (tdir / "sid12345-x.jsonl").write_text(json.dumps({"cwd": rj(mp)["project"]}) + "\n" + json.dumps(
                {"timestamp": "2026-10-24T10:00:00+00:00", "message": {"content": [{"type": "tool_use", "id": "tu1", "name": "Agent", "input": {"description": "Old job", "name": "Zed"}}]}}) + "\n")
            hm = os.environ.get("HOME"); os.environ["HOME"] = tmp
            try: o = office()
            finally: os.environ["HOME"] = hm
            assert [w["id"] for w in o["workers"]] == ["brain-sid12345", "tu1"] and o["workers"][1]["name"] == "Zed" and o["workers"][1]["role"] == "Old job"
            assert o["workers"][1]["status"] == "working" and o["assignments"][0]["title"] == "Old job"


def selfcheck():
    import tempfile
    def refused(*a):  # an illegal reply must die and write no outbox line
        n = len(lines(root() / "donna" / "outbox.jsonl"))
        try: reply("donna", *a)
        except SystemExit: assert len(lines(root() / "donna" / "outbox.jsonl")) == n; return True
        return False
    T = lambda i: capture("donna")["tasks"][i]
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["HIGGS_HOME"] = tmp
        new("donna", project=tmp)
        new("donna", project=tmp + "/moved")  # idempotent: no second agent.new, status untouched, project updated
        assert json.loads((root() / "donna" / "meta.json").read_text())["project"].endswith("/moved")
        tid = send("donna", "fix it", context="ctx")
        assert T(tid)["state"] == "queued" and capture("donna")["state"] == "idle"
        reply("donna", tid, "take", ""); reply("donna", tid, "take", "")  # second take: no-op, no event, no outbox line
        assert T(tid)["state"] == "in_progress" and capture("donna")["state"] == "working" and len(lines(root() / "donna" / "outbox.jsonl")) == 1
        reply("donna", tid, "note", "on it")
        reply("donna", tid, "ask", "blue or green?")  # in_progress -> needs_you
        assert T(tid) | {"ts": 0} == {"state": "needs_you", "task": "fix it", "asked": "blue or green?", "ts": 0}
        assert capture("donna")["state"] == "needs_you"
        reply("donna", tid, "take", "")  # needs_you: no-op
        assert T(tid)["state"] == "needs_you"
        aid = send("donna", "blue", reply_to=tid)  # the answer: not a task, resumes the asked one
        assert aid not in capture("donna")["tasks"] and "asked" not in T(tid) and T(tid)["state"] == "in_progress"
        assert lines(root() / "donna" / "inbox.jsonl")[-1]["in_reply_to"] == tid and "in_reply_to" not in lines(root() / "donna" / "inbox.jsonl")[0]
        assert capture("donna")["state"] == "working"
        send("donna", "stray", reply_to="nope"); send("donna", "stray2", reply_to=tid)  # unknown / not asking: accepted, no change
        assert T(tid)["state"] == "in_progress" and len(capture("donna")["tasks"]) == 1
        t2 = send("donna", "second")  # queued next to an in_progress one: still working
        assert capture("donna")["state"] == "working"
        reply("donna", tid, "say", "done")  # queued is not in progress: idle
        assert (c := capture("donna"))["state"] == "idle" and T(tid)["state"] == "done" and len(c["outbox"]) == 3
        assert c["unread"] == 1  # 2 tasks (answers do not count) minus the say
        json.dumps(c)
        assert all(refused(tid, k, "x") for k in ("take", "ask", "say", "fail"))  # done: refused, nothing written
        reply("donna", tid, "note", "late note")  # a note is fine in any state
        reply("donna", t2, "ask", "which?")  # queued -> needs_you
        assert T(t2)["asked"] == "which?" and capture("donna")["state"] == "needs_you"
        reply("donna", t2, "fail", "gave up")
        assert T(t2)["state"] == "failed" and "asked" not in T(t2) and capture("donna")["state"] == "idle"
        assert refused(t2, "say", "x") and refused(t2, "fail", "x")
        reply("donna", "u1", "take", "")  # unknown take -> in_progress, task None
        assert T("u1")["state"] == "in_progress" and T("u1")["task"] is None
        reply("donna", "u2", "ask", "who?")  # unknown ask -> needs_you
        assert T("u2")["state"] == "needs_you"
        reply("donna", "u3", "note", "hm"); reply("donna", "now", "say", "calling")  # unknown note / say allowed
        assert T("now")["state"] == "done"
        reply("donna", "u4", "fail", "nope"); assert T("u4")["state"] == "failed"
        reply("donna", "u5", "transfer", "Maya"); assert T("u5")["state"] == "done" and "task.transfer" in [e["ev"] for e in lines(root() / "events.jsonl")[-2:]]  # #28
        for i in range(60): reply("donna", f"p{i}", "say", "x")
        assert len(capture("donna")["tasks"]) <= 51  # pruned (unfinished records stay)
        assert send("donna", "x", tid="call_1") == "call_1"  # bridge.py keeps the Higgs call_id
        state("donna", "needs_you")
        close("donna")
        evs = [(e["ev"]) for e in lines(root() / "events.jsonl")]
        assert evs[:14] == ["agent.new", "task.sent", "agent.state", "task.taken", "agent.state", "task.note", "task.needs_you", "agent.state",
                            "task.sent", "agent.state", "task.sent", "task.sent", "task.sent", "task.done"], evs[:14]
        assert evs[-2:] == ["agent.state", "agent.close"], evs[-4:]
        assert [a["name"] for a in ls()] == ["donna"]
    selfcheck_office()
    print("ok")


def main(argv):
    if argv[0] == "hook":  # before argparse: the hook is on the hot path
        return hook(argv[1] if len(argv) > 1 else "")
    import argparse
    p = argparse.ArgumentParser(prog="herd")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("new"); a.add_argument("name"); a.add_argument("--kind", default="session"); a.add_argument("--project")
    a = sub.add_parser("ls"); a.add_argument("--json", action="store_true")
    a = sub.add_parser("send"); a.add_argument("name"); a.add_argument("task"); a.add_argument("--context"); a.add_argument("--from", dest="frm", default="user"); a.add_argument("--reply-to")
    a = sub.add_parser("capture"); a.add_argument("name"); a.add_argument("--json", action="store_true")
    a = sub.add_parser("close"); a.add_argument("name")
    a = sub.add_parser("state"); a.add_argument("name"); a.add_argument("state", choices=["working", "idle", "needs_you", "speaking", "on_call"])
    a = sub.add_parser("reply"); a.add_argument("name"); a.add_argument("id"); a.add_argument("kind", choices=["take", "note", "ask", "say", "fail", "transfer"]); a.add_argument("text")
    x = p.parse_args(argv)
    if x.cmd == "new":
        new(x.name, x.kind, x.project)
    elif x.cmd == "ls":
        rows = ls()
        print(json.dumps(rows)) if x.json else [print(r["name"], r["kind"], r["state"], r["task"] or "", sep="\t") for r in rows]
    elif x.cmd == "send":
        print(send(x.name, x.task, x.context, x.frm, reply_to=x.reply_to))
    elif x.cmd == "capture":
        c = capture(x.name)
        if x.json:
            print(json.dumps(c))
        else:
            print(f"{x.name}: {c['state']} (unread {c['unread']})\ntask: {c['task']}\nlast note: {c['last_note']}")
            [print(f"  {k} {t['state']} {t['task']}" + (f" — asked: {t['asked']}" if t["state"] == "needs_you" else "")) for k, t in c["tasks"].items()]
            [print(f"  [{o['kind']}] {o['text']}") for o in c["outbox"]]
    elif x.cmd == "close":
        close(x.name)
    elif x.cmd == "state":
        state(x.name, x.state)
    else:
        reply(x.name, x.id, x.kind, x.text)


if __name__ == "__main__":
    selfcheck() if len(sys.argv) == 1 else main(sys.argv[1:])
