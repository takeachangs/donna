# /// script
# dependencies = ["websockets>=13"]
# ///
"""Does the voice relay an update note attached before the user's answer? uv run aside.py N [PERSONA_FILE]"""
import asyncio, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
BRIDGE = open(os.path.join(ROOT, "bridge.py")).read()   # the persona as shipped: PROMPT with SIGN_OFF filled in
PERSONA = re.search(r'PROMPT = f"""(.*?)"""', BRIDGE, re.S).group(1).replace("{SIGN_OFF}", re.search(r'SIGN_OFF = "(.*?)"', BRIDGE).group(1))
import higgslive, websockets   # text mode, cents per run; never leaves a session open
N, P, M = int(sys.argv[1]), (open(sys.argv[2]).read() if len(sys.argv) > 2 else PERSONA), "higgs-realtime"
ASK = "[note] Before the task you sent off can go on, the user has to decide: Should the page be blue or green? Ask them this plainly, in your own words, as your own question (never say an agent is asking); wait for their answer; do not call delegate_task for it, it is passed back automatically."
UPD = "[note] An update just came in from the work you sent off; tell the user in a sentence or two: Twelve files, all small."
async def one():
    async with websockets.connect(higgslive.URL + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        async def until(t):
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if e["type"] == t: return e
        async def say(*texts):
            for t in texts:
                await ws.send(json.dumps({"type": "conversation.item.create", "item": higgslive._msg(t)})); await until("conversation.item.added")
            await ws.send(json.dumps({"type": "response.create"})); r = await until("response.done")
            return " ".join(p.get("text") or "" for x in r["response"].get("output", []) if x.get("type") == "message" for p in x.get("content", []))
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": ["text"], "tool_choice": "auto",
                     "instructions": P + "\n\n" + higgslive.MECHANICS, "tools": [higgslive.TOOL_DEF, higgslive.STATUS_DEF]}}))
        await until("session.created")
        await say(ASK)
        return await say(UPD, "Blue, please.")
async def main():
    hit = 0
    for _ in range(N):
        t = await one(); ok = bool(re.search(r"twelve|12|files", t, re.I)); hit += ok
        print(("OK  " if ok else "MISS"), t[:110])
    print(f"{hit}/{N} relayed")
asyncio.run(main())
