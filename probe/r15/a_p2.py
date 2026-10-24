# /// script
# dependencies = ["websockets>=13"]
# ///
"""Tester A phase 2.  uv run a_p2.py fake <model> <N> [strong]  |  multi <model> <N> [once]  |  lat <model> <N>  |  inflight <model> <N>
Raw events → A-tools.jsonl (test names p2-*)."""
import asyncio, json, sys, time
from a_tools import S, PROMPT, TOOL_DEF, MECHANICS, p
from higgslive import NUDGE

ASK = "Can you make a file called groceries.txt on my computer with a short grocery list in it?"
STRONG = "\nNever say you handed off, started, or are working on a task unless you called delegate_task in this very turn."
ONCE = dict(TOOL_DEF, description=TOOL_DEF["description"] + " Call it once per user request; put everything the agent must do in one task.")
SEM = asyncio.Semaphore(int(__import__("os").environ.get("A_CONC", 3)))   # ponytail: 3 sessions at a time; more raised upstream_error in phase 1


async def fake(model, run, strong):
    async with SEM, S(model, "p2-fake" + ("-strong" if strong else ""), run) as s:
        await s.setup([TOOL_DEF], PROMPT + "\n\n" + MECHANICS + (STRONG if strong else ""))
        text, calls, errs, dt = await s.user(ASK)
        r = {"run": run, "t0": "error" if errs else "call" if calls else "fake", "text": text}
        if r["t0"] == "fake":   # exactly what higgslive._handle does: NUDGE as a user item, bare response.create, no wait
            await s.send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": NUDGE}]}})
            text, calls, errs, dt = await s.respond()
            r.update(nudge="error" if errs else "call" if calls else "no-call", nudge_text=text, nudge_task=[json.loads(c["arguments"]).get("task") for c in calls])
        p(json.dumps(r)); return r


async def multi(model, run, once):
    async with SEM, S(model, "p2-multi" + ("-once" if once else ""), run) as s:
        await s.setup([ONCE if once else TOOL_DEF], PROMPT + "\n\n" + MECHANICS)
        text, calls, errs, dt = await s.user(ASK)
        r = {"run": run, "n": len(calls), "errs": bool(errs), "tasks": [json.loads(c["arguments"]).get("task") for c in calls]}
        p(json.dumps(r)); return r


async def lat(model, run, tools, mech):
    async with SEM, S(model, f"p2-lat-tools{int(tools)}-mech{int(mech)}", run) as s:
        await s.setup([TOOL_DEF] if tools else [], PROMPT + ("\n\n" + MECHANICS if mech else ""))
        await s.send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "What's the capital of Australia?"}]}})
        t = time.time(); await s.send({"type": "response.create"}); first = None
        while True:
            ev, _ = await s.until(lambda e: True, 30)
            if not ev: break
            if first is None and ev["type"].endswith(".delta"): first = time.time() - t
            if ev["type"] == "response.done": break
        u = (ev or {}).get("response", {}).get("usage") or {}
        r = {"tools": tools, "mech": mech, "first": round(first or -1, 2), "done": round(time.time() - t, 2), "in": u.get("input_tokens"), "out": u.get("output_tokens"), "status": (ev or {}).get("response", {}).get("status")}
        p(json.dumps(r)); return r


async def inflight(model, run):
    """two tasks in two turns, outputs returned in reverse order; does each land on the right task?"""
    async with SEM, S(model, "p2-inflight", run) as s:
        await s.setup([TOOL_DEF], PROMPT + "\n\n" + MECHANICS)
        ids = []
        for ask in ("Please make a file called groceries.txt with a short grocery list.", "Also, can you check how many Python files are in my projects folder?"):
            for attempt in (ask, NUDGE):   # one nudge retry if it fake-claims, as the layer does
                text, calls, errs, dt = await s.user(attempt)
                c = [c for c in calls if c["name"] == TOOL_DEF["name"]]
                if c: ids.append((c[0]["call_id"], json.loads(c[0]["arguments"]).get("task"))); await s.respond(); break
        if len(ids) < 2: p(json.dumps({"run": run, "abort": f"only {len(ids)} calls"})); return
        outs = {ids[1][0]: "Found 47 Python files in ~/projects.", ids[0][0]: "Created groceries.txt with: apples, rice, tofu, spinach."}
        res = []
        for cid, out in outs.items():   # reverse order: the second task's result first
            await s.item({"type": "function_call_output", "call_id": cid, "output": out})
            res.append((await s.respond())[0])
        res.append((await s.user("Remind me: how many Python files, and what's in the grocery file?"))[0])
        p(json.dumps({"run": run, "tasks": [t for _, t in ids], "after_out2": res[0], "after_out1": res[1], "recall": res[2]}))


async def main():
    cmd, model, n = sys.argv[1], sys.argv[2], int(sys.argv[3]); flag = len(sys.argv) > 4
    if cmd == "fake": await asyncio.gather(*(fake(model, i, flag) for i in range(n)))
    if cmd == "multi": await asyncio.gather(*(multi(model, i, flag) for i in range(n)))
    if cmd == "lat": await asyncio.gather(*(lat(model, i, t, m) for i in range(n) for t in (0, 1) for m in (0, 1)))
    if cmd == "inflight": await asyncio.gather(*(inflight(model, i) for i in range(n)))

asyncio.run(main())
