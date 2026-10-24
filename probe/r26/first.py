# /// script
# dependencies = ["websockets>=13"]
# ///
"""First-turn delegation rate: uv run first.py MODEL ROUNDS [PERSONA_FILE] (default: bridge.py's PROMPT)"""
import asyncio, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
BRIDGE = open(os.path.join(ROOT, "bridge.py")).read()   # the persona as shipped: PROMPT with SIGN_OFF filled in
PERSONA = re.search(r'PROMPT = f"""(.*?)"""', BRIDGE, re.S).group(1).replace("{SIGN_OFF}", re.search(r'SIGN_OFF = "(.*?)"', BRIDGE).group(1))
import higgslive, websockets   # text mode, cents per run; never leaves a session open
P, M, N = (open(sys.argv[3]).read() if len(sys.argv) > 3 else PERSONA), sys.argv[1], int(sys.argv[2])
REQ = ["make me a page with a blue background", "write a short poem about cats into a file", "check how many python files are in this folder",
       "what's in my downloads folder", "make me a game", "improve the readme"]
async def one(text):
    async with websockets.connect(higgslive.URL + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        async def until(t):
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if e["type"] == "error": print("  ERR", e["error"].get("message", "")[:100])
                if e["type"] == t: return e
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": ["text"], "tool_choice": "auto",
                     "instructions": P + "\n\n" + higgslive.MECHANICS, "tools": [higgslive.TOOL_DEF, higgslive.STATUS_DEF]}}))
        await until("session.created")
        await ws.send(json.dumps({"type": "conversation.item.create", "item": higgslive._msg(text)})); await until("conversation.item.added")
        await ws.send(json.dumps({"type": "response.create"})); r = await until("response.done")
        o = r["response"].get("output", [])
        calls = [x for x in o if x.get("type") == "function_call" and x.get("name") == higgslive.TOOL]
        said = " ".join(p.get("text") or "" for x in o if x.get("type") == "message" for p in x.get("content", []))
        return bool(calls), said
async def main():
    hits = 0
    for _ in range(N):
        for t in REQ:
            try: c, s = await one(t)
            except Exception as e: print("FAIL", repr(e)); continue
            hits += c
            if not c: print(f"  miss: {t!r} -> {s[:90]!r}")
    print(f"{M}: {hits}/{N*len(REQ)} first-turn calls")
asyncio.run(main())
