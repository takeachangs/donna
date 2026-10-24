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
    uv run herd.py                             # self-check (temp dir, never touches ~/.higgs)

Layout under $HIGGS_HOME/herd (HIGGS_HOME defaults to ~/.higgs): events.jsonl (append-only log) and
<name>/{meta.json,status.json,inbox.jsonl,outbox.jsonl}. JSONL = one appended line; JSON = atomic replace.
"""
import argparse, json, os, sys, tempfile, time, uuid
from pathlib import Path


def root() -> Path:  # resolved per call so tests can set HIGGS_HOME
    return Path(os.environ.get("HIGGS_HOME") or Path.home() / ".higgs") / "herd"


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
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as f:
        json.dump(obj, f)
    os.replace(f.name, path)


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
        if project:  # the session may have moved; bridge.py hook matches on this path
            write_json(d / "meta.json", {**json.loads((d / "meta.json").read_text()), "project": str(Path(project).resolve())})
        return
    d.mkdir(parents=True, exist_ok=True)
    ts = time.time()
    write_json(d / "meta.json", {"name": name, "kind": kind, "project": str(Path(project or ".").resolve()),
                                 "parent": None, "created": ts})
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


def send(name, task, context=None, frm="user", tid=None, reply_to=None):  # tid: the caller's id (bridge.py passes the Higgs call_id)
    d = agent_dir(name)
    tid = tid or uuid.uuid4().hex[:8]
    line = {"id": tid, "task": task, "context": context, "from": frm, "ts": time.time()}
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


EV = {"take": "task.taken", "ask": "task.needs_you", "say": "task.done", "fail": "task.failed"}


def reply(name, tid, kind, text):  # take|note|ask|say|fail; an illegal transition dies before writing anything
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
                               "state": {"take": "in_progress", "ask": "needs_you", "say": "done", "fail": "failed"}[kind]}
        t.pop("asked", None)
        if kind == "ask":
            t["asked"] = text
        if kind in ("say", "fail"):
            s["unread"] = max(0, s["unread"] - 1)
            old = [k for k, v in s["tasks"].items() if v["state"] in ("done", "failed")]
            for k in old[:max(0, len(s["tasks"]) - 50)]:
                del s["tasks"][k]  # oldest finished first (dict order), keeps tasks small
    settle(d, name, s, EV.get(kind, "task.note"), id=tid, text=text)


def selfcheck():
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
    print("ok")


def main(argv):
    p = argparse.ArgumentParser(prog="herd")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("new"); a.add_argument("name"); a.add_argument("--kind", default="session"); a.add_argument("--project")
    a = sub.add_parser("ls"); a.add_argument("--json", action="store_true")
    a = sub.add_parser("send"); a.add_argument("name"); a.add_argument("task"); a.add_argument("--context"); a.add_argument("--from", dest="frm", default="user"); a.add_argument("--reply-to")
    a = sub.add_parser("capture"); a.add_argument("name"); a.add_argument("--json", action="store_true")
    a = sub.add_parser("close"); a.add_argument("name")
    a = sub.add_parser("state"); a.add_argument("name"); a.add_argument("state", choices=["working", "idle", "needs_you", "speaking", "on_call"])
    a = sub.add_parser("reply"); a.add_argument("name"); a.add_argument("id"); a.add_argument("kind", choices=["take", "note", "ask", "say", "fail"]); a.add_argument("text")
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
