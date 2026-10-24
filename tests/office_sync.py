#!/usr/bin/env python3
"""Office sync, offline and deterministic (#65): replay a recorded brain run (tests/fixtures/office_run.jsonl, made by
tests/record_office_events.py) through the real herd code (send/reply/hook) in a temp HIGGS_HOME, take herd.office() after
every step, and check the office.json timeline against what happened.

  uv run tests/office_sync.py [FIXTURE]                 run the checks (default fixture: tests/fixtures/office_run.jsonl)
  uv run tests/office_sync.py --snapshots OUT [FIXTURE]  also write the timeline for the office's own test
                                                          (office/tests/fixtures/office-sync.json; re-run after re-recording)
"""
import contextlib, io, json, os, re, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import herd  # noqa: E402


def replay(fixture):
    head, *steps = [json.loads(l) for l in Path(fixture).read_text().splitlines() if l.strip()]
    tl = []  # (step, office snapshot) after every step
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["HIGGS_HOME"] = tmp
        with contextlib.redirect_stderr(io.StringIO()): herd.new("donna", project=head["project"])
        brain = next(s["data"]["session_id"] for s in steps if "hook" in s and not s["data"].get("agent_id"))
        herd.write_json(herd.root() / "donna" / "meta.json", {**herd.rj(herd.root() / "donna" / "meta.json"), "session": brain})  # /call step 1 registers it
        for s in steps:
            if "send" in s: herd.send("donna", s["send"]["task"], tid=s["send"]["tid"], reply_to=s["send"].get("reply_to"))
            elif "reply" in s: herd.reply("donna", s["reply"]["tid"], s["reply"]["kind"], s["reply"]["text"])
            elif "spoken" in s: herd.event("task.spoken", "donna", id=s["spoken"])
            else:
                herd.parent_args = lambda p=s.get("parent", ""): p  # the Claude Code process that fired it (names a teammate)
                with contextlib.redirect_stdout(io.StringIO()): herd.hook(s["hook"], s["data"])
            tl.append((s, herd.office()))
    return tl


def check(tl):
    lead = lambda o: o["workers"][0]
    row = lambda o, i: next((w for w in o["workers"] if w["id"] == i), None)
    at = lambda pred: next(k for k, (s, _) in enumerate(tl) if pred(s))  # index of the first step matching pred
    hk = lambda s, ev, tool=None: s.get("hook") == ev and (tool is None or s["data"].get("tool_name") == tool)
    tid = next(s["send"]["tid"] for s, _ in tl if "send" in s)

    # delegate: a queued assignment and "Got it" at once, before the brain does anything
    k = at(lambda s: "send" in s); o = tl[k][1]
    assert [(a["id"], a["status"], a["workerId"]) for a in o["assignments"]] == [(tid, "queued", lead(o)["id"])], o["assignments"]
    assert lead(o)["currentAction"].startswith("Got it: "), lead(o)

    # take: working, "Reading the repo"; the queued assignment is gone
    k = at(lambda s: hk(s, "PostToolUse", "Bash") and " take " in s["data"]["tool_input"]["command"]); o = tl[k][1]
    assert (lead(o)["status"], lead(o)["currentAction"]) == ("working", "Reading the repo") and not any(a["status"] == "queued" for a in o["assignments"]), lead(o)

    # the hiring note comes BEFORE the spawn; from it until each spawn the named workers stand with Donna, being briefed, in her project
    note = at(lambda s: s.get("reply", {}).get("kind") == "note")
    spawns = [k for k, (s, _) in enumerate(tl) if hk(s, "PostToolUse", "Agent")]
    assert len(spawns) == 2 and note < spawns[0], (note, spawns)
    names = [tl[k][0]["data"]["tool_input"]["name"] for k in spawns]
    for k in range(note, spawns[0]):
        o = tl[k][1]
        assert sorted((w["name"], w["status"], w["currentAction"], w["projectId"]) for w in o["workers"][1:]) == \
            sorted((n, "queued", "Being briefed", lead(o)["projectId"]) for n in names), o["workers"]

    # spawn -> working "Hired: <description>" until the worker's first tool; never done before its own stop; done from it on
    for k in spawns:
        s = tl[k][0]; i, n = s["data"]["tool_response"]["agentId"], s["data"]["tool_input"]["name"]
        w = row(tl[k][1], i)
        assert (w["name"], w["status"], w["currentAction"]) == (n, "working", "Hired: " + s["data"]["tool_input"]["description"]), w
        assert row(tl[k][1], f"brief-{n}") is None  # the briefed stand-in left: the hire walks to a desk
        mine = lambda s: i in (s.get("data", {}).get("agent_id"), (re.search(r"--agent-id (\S+)", s.get("parent", "")) or [None, None])[1])  # a teammate: its process args name it
        stop = at(lambda s: mine(s) and (hk(s, "SubagentStop") or hk(s, "Stop") or hk(s, "PostToolUse", "SubagentHandback")))
        assert k < stop
        for j in range(k, len(tl)):
            st, w = tl[j][0], row(tl[j][1], i)
            assert w["status"] == ("done" if j >= stop else "working"), (j, st.get("hook"), w)
            if j < stop and mine(st) and hk(st, "PostToolUse"):  # a worker tool event moves its line, in words
                assert w["currentAction"] == herd.action({"tool": st["data"]["tool_name"], "input": st["data"]["tool_input"]}) != "", w
        assert next(a for a in tl[-1][1]["assignments"] if a["id"] == i)["status"] == "done"

    # while her turn is over and workers are out, Donna waits on them by name; only workers who stopped are done (lounge)
    for s, o in tl:
        busy = [w["name"] for w in o["workers"][1:] if w["status"] == "working"]
        if lead(o)["status"] != "working" and busy and not o["decisions"]:
            assert (lead(o)["status"], lead(o)["currentAction"]) == ("waiting", "Waiting on " + herd.both(busy)), lead(o)

    # say -> a queued briefing naming both workers; the voice speaks it -> presented
    k = at(lambda s: s.get("reply", {}).get("kind") == "say"); b = tl[k][1]["briefings"]
    assert [(x["id"], x["status"]) for x in b] == [(tid, "queued")] and sorted(c["name"] for c in b[0]["contributors"]) == sorted(names), b
    k = at(lambda s: "spoken" in s)
    assert [x["status"] for x in tl[k][1]["briefings"]] == ["presented"]
    o = tl[-1][1]
    assert (lead(o)["status"], lead(o)["currentAction"]) == ("done", "Ready") and all(w["status"] == "done" for w in o["workers"][1:]), o["workers"]


if __name__ == "__main__":
    a = sys.argv[1:]
    out = a[a.index("--snapshots") + 1] if "--snapshots" in a else None
    rest = [x for x in a if x not in ("--snapshots", out)]
    tl = replay(rest[0] if rest else HERE / "fixtures" / "office_run.jsonl")
    check(tl)
    if out:
        label = lambda s: s.get("hook", "") + (f" {s['data'].get('tool_name')}" if s.get("data", {}).get("tool_name") else "") if "hook" in s else \
            next(k for k in ("send", "reply", "spoken") if k in s) + (f" {s['reply']['kind']}" if "reply" in s else "")
        Path(out).write_text(json.dumps([{"step": label(s), "workspace": o} for s, o in tl], indent=1) + "\n")
    print(f"ok ({len(tl)} steps)")
