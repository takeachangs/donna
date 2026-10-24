# /// script
# dependencies = ["websockets>=13"]
# ///
"""#43 typed probes, text mode: uv run probe/r43/probe.py ROUNDS [unclear|status|earlier|control ...] (default all four).
unclear: the task line keeps the user's unclear object (no invented one); status: task_status is called and the reply uses the
office (workers, queue, open question, unspoken result); earlier: "what did I ask" calls a tool; control: file questions still go to delegate_task."""
import asyncio, json, os, re, sys, tempfile, time
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
BRIDGE = open(os.path.join(ROOT, "bridge.py")).read()   # the persona as shipped: PROMPT with SIGN_OFF filled in
PERSONA = re.search(r'PROMPT = f"""(.*?)"""', BRIDGE, re.S).group(1).replace("{SIGN_OFF}", re.search(r'SIGN_OFF = "(.*?)"', BRIDGE).group(1))
import higgslive, websockets   # never leaves a session open
M, N = "higgs-realtime", int(sys.argv[1])
SETS = {
    "unclear": ["Can you make like a simple HTML for explaining about this, okay?", "Write a short summary of that and save it.", "Make a diagram of this.",
                "Can you put this into a slide?", "Can you write an explainer for this thing?", "Turn that into a checklist.", "Make a quick demo of it.",
                "Can you build a little website about this, okay?", "Make a one-pager about this for the judges.", "Can you make a poster for it?"],
    "status": ["How many agents do we have? Why are so many chilling in the lounge?", "Anything being worked on right now? Any reports?",
               "Who's on the team right now?", "What are the workers doing?", "Is anyone still working?", "Did anything finish while I was away?",
               "Any updates for me?", "How's the team doing?", "What's everybody up to in the office?", "Do I have any results waiting?"],
    "earlier": ["What did I tell you to get started?", "What did I ask you to do earlier?", "Remind me what I asked you for."],
    "control": ["what's in my downloads folder", "check how many python files are in this folder", "make me a page with a blue background"],
}
INVENTED = re.compile(r"delegate|task_status|function|\btool\b|hackathon|donna|higgs|project|the agent|provided|given|specified|mentioned|\buser\b|topic|subject", re.I)   # her own prompt's objects, or "the content the user provided"

def fixture(tmp):   # the office at a moment like 09:48, plus one of each kind: Ava working, Bob done, a queued task, an open ask, an unspoken result
    h, now = os.path.join(tmp, "herd", "donna"), time.time()
    os.makedirs(h)
    json.dump({"state": "needs_you", "tasks": {"q1": {"state": "queued", "task": "Make the quiz harder.", "ts": now - 30},
                                               "a1": {"state": "needs_you", "task": "Pick a colour for the site.", "asked": "Blue or green?", "ts": now - 90},
                                               "d1": {"state": "done", "task": "Build the website.", "ts": now - 300}}}, open(os.path.join(h, "status.json"), "w"))
    lid = "brain-x"
    json.dump({"revision": 1, "call": {"state": "listening"}, "workers": [
        {"id": lid, "name": "Donna", "role": "Brain", "status": "done", "lead": True},
        {"id": "ava1", "name": "Ava", "role": "Writes the site page", "status": "working"},
        {"id": "bob1", "name": "Bob", "role": "Counts the files", "status": "done"}],
        "briefings": [{"id": "d1", "workerId": "bob1", "summary": "The website is done and on its own branch. Want me to open a pull request?", "status": "queued"},
                      {"id": "d0", "workerId": lid, "summary": "We're in the hackathon project.", "status": "presented"}]}, open(os.path.join(tmp, "office.json"), "w"))

async def one(text):
    async with websockets.connect(higgslive.URL + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        async def until(t):
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if e["type"] == "error": print("  ERR", e["error"].get("message", "")[:100])
                if e["type"] == t: return e
        said = lambda r: " ".join(p.get("text") or "" for x in r["response"].get("output", []) if x.get("type") == "message" for p in x.get("content", []))
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": ["text"], "tool_choice": "auto",
                     "instructions": PERSONA + "\n\n" + higgslive.MECHANICS, "tools": [higgslive.TOOL_DEF, higgslive.STATUS_DEF]}}))
        await until("session.created")
        await ws.send(json.dumps({"type": "conversation.item.create", "item": higgslive._msg(text)})); await until("conversation.item.added")
        await ws.send(json.dumps({"type": "response.create"})); r = await until("response.done")
        calls = [x for x in r["response"].get("output", []) if x.get("type") == "function_call"]
        names, task, reply = [c["name"] for c in calls], next((json.loads(c["arguments"]).get("task", "") for c in calls if c["name"] == higgslive.TOOL), None), said(r)
        if not names and (higgslive.CLAIM.search(reply.lower()) or higgslive.ASKED.search(text.lower()) and higgslive.OFFER.search(reply.lower())):   # the layer's GUARD: one nudge
            await ws.send(json.dumps({"type": "conversation.item.create", "item": higgslive._msg(higgslive.NUDGE)})); await until("conversation.item.added")
            await ws.send(json.dumps({"type": "response.create"})); r = await until("response.done"); reply += " || nudged: " + said(r)
            calls = [x for x in r["response"].get("output", []) if x.get("type") == "function_call"]
            names, task = [c["name"] for c in calls], next((json.loads(c["arguments"]).get("task", "") for c in calls if c["name"] == higgslive.TOOL), None)
        if higgslive.STATUS in names and higgslive.TOOL not in names:   # the layer: output now, then a bare response.create
            c = next(c for c in calls if c["name"] == higgslive.STATUS)
            out = higgslive.status_summary(time.time() - 60)
            await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": c["call_id"], "output": out}}))
            await until("conversation.item.added")
            await ws.send(json.dumps({"type": "response.create"})); reply += " || " + said(await until("response.done"))
        return names, task, reply

async def main():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["HIGGS_HOME"] = tmp; fixture(tmp)
        print("status output:", higgslive.status_summary(time.time() - 60))
        for k in sys.argv[2:] or list(SETS):
            score, n = 0, 0
            for _ in range(N):
                for t in SETS[k]:
                    try: names, task, reply = await one(t)
                    except Exception as e: print("FAIL", t, repr(e)); continue
                    n += 1
                    if k == "unclear": ok = task is not None and not INVENTED.search(task)
                    elif k == "status": ok = names == [higgslive.STATUS] and bool(re.search(r"\bava\b|website|blue or green|quiz", reply, re.I))
                    elif k == "earlier": ok = bool(names)
                    else: ok = names == [higgslive.TOOL]
                    score += ok
                    print(f"  {'ok ' if ok else 'BAD'} [{k}] {t!r} -> {names} task={task!r} said={reply[:220]!r}")
            print(f"== {k}: {score}/{n}")
asyncio.run(main())
