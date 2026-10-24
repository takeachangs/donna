# /// script
# dependencies = ["websockets>=13"]
# ///
"""#56 typed probes, text mode: uv run probe/r56/voice.py ROUNDS [open|dispatch ...] (default both; BOSON_API_KEY = key 2).
open: an open question ("what could we be doing right now?") is a delegate_task, never a refusal.
dispatch: "dispatch an agent to make X" is a delegate_task whose ack claims no agent; then "are you doing it or someone else?"
goes to task_status and, with no note naming a worker, the reply names nobody and claims no agent; with a note naming Ava, it says Ava."""
import asyncio, json, os, re, sys, tempfile, time
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
BRIDGE = open(os.path.join(ROOT, "bridge.py")).read()   # the persona as shipped: PROMPT with SIGN_OFF filled in
PERSONA = open(os.environ["PERSONA"]).read() if os.environ.get("PERSONA") else re.search(r'PROMPT = f"""(.*?)"""', BRIDGE, re.S).group(1).replace("{SIGN_OFF}", re.search(r'SIGN_OFF = "(.*?)"', BRIDGE).group(1))   # PERSONA=file: a draft
import higgslive, websockets   # never leaves a session open
if os.environ.get("STATUS_EXTRA"): higgslive.STATUS_DEF = {**higgslive.STATUS_DEF, "description": higgslive.STATUS_DEF["description"] + " " + os.environ["STATUS_EXTRA"]}   # a draft of the tool text
M, N = "higgs-realtime", int(sys.argv[1])
OPEN = ["Okay. Um, what are some things that we could be doing right now?", "What could we be doing right now?", "What should we work on next?",
        "Any ideas what we could do with the next hour?", "What's left to do on this project?", "What would you work on if you were me?",
        "Got any suggestions for what to build next?", "So what's the next step, do you think?", "Where should we go from here?", "What can we get done before the demo?"]
DISPATCH = ["Can you dispatch an agent to come up with a really nice website to describe the project?", "Get an agent to make a landing page for the bakery.",
            "Have someone write a README for the quiz app.", "Dispatch an agent to build a little snake game.", "Can you get someone to make a pricing page?",
            "Send an agent to write tests for the login page.", "Get the team to make a logo page for the hackathon.", "Hire someone to make a slide deck about the project.",
            "Can you have an agent put together a demo script?", "Dispatch somebody to make a contact form."]
WHO = "Are you working on it, or are you getting someone else to work on it?"
REFUSE = re.compile(r"can'?t (really )?(talk|discuss|help with|get into)|not (able|allowed) to (talk|discuss)|on this line", re.I)
AGENT = r"(agent|someone|somebody|worker|teammate|developer|one of (the|my) (team|people)|the team)"
CLAIM = re.compile(rf"\b(an? |the |one |some )?{AGENT}s?\b[^.!?]{{0,30}}\b(is|are|'s|'re|has|have|now|already|currently|working|on it|on that|started)\b|"
                   rf"\b(getting|got|dispatch\w*|assign\w*|delegat\w*|sending|sent|putting|bringing|having|hand\w*)\b[^.!?]{{0,15}}\b(an? |the |one |some )?{AGENT}\b", re.I)

def fixture(tmp, kind):   # idle: nothing running, Ava finished earlier (the 10:38 office); none: the brain took the task a minute ago, no note; named: its note names Ava
    h, now = os.path.join(tmp, "herd"), time.time(); os.makedirs(os.path.join(h, "donna"))
    task = {"state": "done", "task": "Build the website.", "ts": now - 900} if kind == "idle" else {"state": "in_progress", "task": "Make the page.", "ts": now - 60}
    json.dump({"state": "idle" if kind == "idle" else "working", "tasks": {"t1": task}}, open(os.path.join(h, "donna", "status.json"), "w"))
    evs = [{"ts": task["ts"], "ev": "task.sent", "agent": "donna", "id": "t1", "task": task["task"]}]
    if kind == "named": evs.append({"ts": now - 50, "ev": "task.note", "agent": "donna", "id": "t1", "text": "Ava is on it, writing the page."})
    open(os.path.join(h, "events.jsonl"), "w").write("".join(json.dumps(e) + "\n" for e in evs))
    ws = [{"id": "brain-x", "name": "Donna", "role": "Brain", "status": "done" if kind == "idle" else "working", "lead": True}]
    if kind != "none": ws.append({"id": "ava1", "name": "Ava", "role": "Writes the page", "status": "done" if kind == "idle" else "working"})
    json.dump({"revision": 1, "call": {"state": "listening"}, "workers": ws, "briefings": []}, open(os.path.join(tmp, "office.json"), "w"))

async def session(turns):
    """Each user turn → (tool names, reply text, nudged); the layer's moves: GUARD's one nudge, delegate_task left open with a bare
    response.create for the ack, task_status answered at once."""
    async with websockets.connect(higgslive.URL + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        async def until(t):
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if e["type"] == "error": print("  ERR", e["error"].get("message", "")[:100])
                if e["type"] == t: return e
        said = lambda r: " ".join(p.get("text") or "" for x in r["response"].get("output", []) if x.get("type") == "message" for p in x.get("content", []))
        fcs = lambda r: [x for x in r["response"].get("output", []) if x.get("type") == "function_call"]
        async def item(it): await ws.send(json.dumps({"type": "conversation.item.create", "item": it})); await until("conversation.item.added")
        async def respond(): await ws.send(json.dumps({"type": "response.create"})); return await until("response.done")
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": ["text"], "tool_choice": "auto",
                     "instructions": PERSONA + "\n\n" + higgslive.MECHANICS, "tools": [higgslive.TOOL_DEF, higgslive.STATUS_DEF]}}))
        await until("session.created"); out = []
        for text in turns:
            await item(higgslive._msg(text)); r = await respond(); names, reply, nudged = [], "", False
            for _ in range(3):   # the layer: GUARD's one nudge; task_status answered at once, then a bare response.create; an open delegate_task gets one for the ack
                calls = fcs(r); reply += (" || " if reply else "") + said(r); names += [c["name"] for c in calls]
                if not calls and not nudged and higgslive.TOOL not in names and (higgslive.CLAIM.search(said(r).lower()) or higgslive.ASKED.search(text.lower()) and higgslive.OFFER.search(said(r).lower())):
                    await item(higgslive._msg(higgslive.NUDGE)); r = await respond(); nudged = True; reply += " || nudged:"; continue
                st = [c for c in calls if c["name"] == higgslive.STATUS]
                for c in st: await item({"type": "function_call_output", "call_id": c["call_id"], "output": higgslive.status_summary(time.time() - 120)})
                if st or calls and not said(r): r = await respond(); continue
                break
            out.append((names, reply, nudged))
        return out

async def main():
    for k in sys.argv[2:] or ["open", "dispatch"]:
        score = n = first = 0; who = {False: [0, 0], True: [0, 0]}
        for i in range(N):
            for j, t in enumerate(OPEN if k == "open" else DISPATCH):
                named = bool(j % 2)
                with tempfile.TemporaryDirectory() as tmp:
                    os.environ["HIGGS_HOME"] = tmp; fixture(tmp, "idle" if k == "open" else "named" if named else "none")
                    try: res = await session([t] if k == "open" else [t, WHO])
                    except Exception as e: print("FAIL", t, repr(e)); continue
                n += 1
                (names, reply, nudged) = res[0]; reply = reply.replace("’", "'")
                if k == "open":
                    ok = higgslive.TOOL in names and not REFUSE.search(reply); score += ok; first += ok and not nudged
                    print(f"  {'ok ' if ok else 'BAD'} {t!r} -> {names}{' (nudged)' if nudged else ''} said={reply[:200]!r}")
                else:
                    ok = higgslive.TOOL in names and not CLAIM.search(reply); score += ok; first += ok and not nudged
                    (n2, r2, _) = res[1]; r2 = r2.replace("’", "'")
                    ok2 = not CLAIM.search(r2) and (bool(re.search(r"\bava\b", r2, re.I)) if named else not re.search(r"\bava\b", r2, re.I))
                    who[named][0] += ok2; who[named][1] += 1
                    print(f"  {'ok ' if ok else 'BAD'} {t!r} -> {names}{' (nudged)' if nudged else ''} ack={reply[:160]!r}")
                    print(f"     {'ok ' if ok2 else 'BAD'} who ({'note names Ava' if named else 'no note'}) -> {n2} said={r2[:200]!r}")
        print(f"== {k}: {score}/{n} ({first} without GUARD's nudge)" + (f"; who, no note: {who[False][0]}/{who[False][1]}, who, Ava's note: {who[True][0]}/{who[True][1]}" if k == "dispatch" else ""))
asyncio.run(main())
