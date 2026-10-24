# /// script
# dependencies = []
# ///
"""herd: a file-based registry/mailbox for agents. Stdlib only.

    uv run herd.py new donna --project .       # register an agent
    uv run herd.py send donna "fix the bug"    # prints the task id
    uv run herd.py reply donna <id> note "looking"   # silent progress
    uv run herd.py reply donna <id> say "done"       # spoken result, agent goes idle
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
                                   "started": ts, "unread": 0})
    event("agent.new", name, kind=kind, parent=None)


def ls():
    out = []
    for m in sorted(root().glob("*/meta.json")):
        meta, st = json.loads(m.read_text()), json.loads((m.parent / "status.json").read_text())
        out.append({**meta, **st})
    return out


def send(name, task, context=None, frm="user"):
    d = agent_dir(name)
    tid = uuid.uuid4().hex[:8]
    append(d / "inbox.jsonl", {"id": tid, "task": task, "context": context, "from": frm, "ts": time.time()})
    update(d, unread=json.loads((d / "status.json").read_text())["unread"] + 1, task_id=tid, task=task)
    event("task.sent", name, id=tid, task=task, **{"from": frm})
    return tid


def capture(name):
    d = agent_dir(name)
    return {**json.loads((d / "status.json").read_text()), "outbox": lines(d / "outbox.jsonl", 3)}


def close(name):
    update(agent_dir(name), state="dead")
    event("agent.close", name)


def state(name, st):
    update(agent_dir(name), state=st)
    event("agent.state", name, state=st)


def reply(name, tid, kind, text):
    d = agent_dir(name)
    append(d / "outbox.jsonl", {"id": tid, "kind": kind, "text": text, "ts": time.time()})
    if kind == "note":
        update(d, last_note=text)
        event("task.note", name, id=tid, text=text)
    else:
        event("task.done", name, id=tid, text=text)
        update(d, unread=max(0, json.loads((d / "status.json").read_text())["unread"] - 1))
        state(name, "idle")


def selfcheck():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["HIGGS_HOME"] = tmp
        new("donna", project=tmp)
        new("donna", project=tmp + "/moved")  # idempotent: no second agent.new, status untouched, project updated
        assert json.loads((root() / "donna" / "meta.json").read_text())["project"].endswith("/moved")
        tid = send("donna", "fix it", context="ctx")
        reply("donna", tid, "note", "on it")
        reply("donna", tid, "say", "done")
        assert (c := capture("donna"))["state"] == "idle" and c["unread"] == 0 and len(c["outbox"]) == 2
        json.dumps(c)
        state("donna", "working")
        close("donna")
        assert [e["ev"] for e in lines(root() / "events.jsonl")] == [
            "agent.new", "task.sent", "task.note", "task.done", "agent.state", "agent.state", "agent.close"]
        assert [a["name"] for a in ls()] == ["donna"]
    print("ok")


def main(argv):
    p = argparse.ArgumentParser(prog="herd")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("new"); a.add_argument("name"); a.add_argument("--kind", default="session"); a.add_argument("--project")
    a = sub.add_parser("ls"); a.add_argument("--json", action="store_true")
    a = sub.add_parser("send"); a.add_argument("name"); a.add_argument("task"); a.add_argument("--context"); a.add_argument("--from", dest="frm", default="user")
    a = sub.add_parser("capture"); a.add_argument("name"); a.add_argument("--json", action="store_true")
    a = sub.add_parser("close"); a.add_argument("name")
    a = sub.add_parser("state"); a.add_argument("name"); a.add_argument("state", choices=["working", "idle", "speaking", "on_call"])
    a = sub.add_parser("reply"); a.add_argument("name"); a.add_argument("id"); a.add_argument("kind", choices=["note", "say"]); a.add_argument("text")
    x = p.parse_args(argv)
    if x.cmd == "new":
        new(x.name, x.kind, x.project)
    elif x.cmd == "ls":
        rows = ls()
        print(json.dumps(rows)) if x.json else [print(r["name"], r["kind"], r["state"], r["task"] or "", sep="\t") for r in rows]
    elif x.cmd == "send":
        print(send(x.name, x.task, x.context, x.frm))
    elif x.cmd == "capture":
        c = capture(x.name)
        if x.json:
            print(json.dumps(c))
        else:
            print(f"{x.name}: {c['state']} (unread {c['unread']})\ntask: {c['task']}\nlast note: {c['last_note']}")
            [print(f"  [{o['kind']}] {o['text']}") for o in c["outbox"]]
    elif x.cmd == "close":
        close(x.name)
    elif x.cmd == "state":
        state(x.name, x.state)
    else:
        reply(x.name, x.id, x.kind, x.text)


if __name__ == "__main__":
    selfcheck() if len(sys.argv) == 1 else main(sys.argv[1:])
