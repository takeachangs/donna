# /// script
# dependencies = ["websockets>=13"]
# ///
"""Text-mode probe: does the voice set delegate_task.replaces on a correction, and never on a second task? uv run replaces.py MODEL"""
import asyncio, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
BRIDGE = open(os.path.join(ROOT, "bridge.py")).read()   # the persona as shipped: PROMPT with SIGN_OFF filled in
PERSONA = re.search(r'PROMPT = f"""(.*?)"""', BRIDGE, re.S).group(1).replace("{SIGN_OFF}", re.search(r'SIGN_OFF = "(.*?)"', BRIDGE).group(1))
import higgslive, websockets   # text mode, cents per run; never leaves a session open
M = sys.argv[1] if len(sys.argv) > 1 else "higgs-realtime"
TOOL = json.loads(json.dumps(higgslive.TOOL_DEF))
if "replaces" not in TOOL["parameters"]["properties"]:
    TOOL["parameters"]["properties"]["replaces"] = {"type": "boolean", "description": "true when this request corrects or changes the one you sent just before; the earlier one is dropped"}
CASES = [("make me a page with a blue background", "actually, make it green", True),
         ("make me a page with a blue background", "no wait, I meant a countdown timer page instead", True),
         ("write a short poem about cats into a file", "sorry, make that dogs, not cats", True),
         ("check how many python files are in this folder", "actually just the test files", True),
         ("make me a page with a blue background", "also count the files in the folder", False),
         ("write a short poem about cats into a file", "and while you're at it, check the git status", False),
         ("check how many python files are in this folder", "can you also open the readme in my browser", False)]
async def run(t1, t2):
    async with websockets.connect(higgslive.URL + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        async def send(e): await ws.send(json.dumps(e))
        async def until(t):
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if e["type"] == "error": print("  ERR", e["error"].get("message", "")[:120])
                if e["type"] == t: return e
        await send({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": ["text"], "tool_choice": "auto",
                     "instructions": PERSONA + "\n\n" + higgslive.MECHANICS, "tools": [TOOL, higgslive.STATUS_DEF]}})
        await until("session.created")
        out = []
        for text in (t1, t2):
            await send({"type": "conversation.item.create", "item": higgslive._msg(text)}); await until("conversation.item.added")
            await send({"type": "response.create"}); r = await until("response.done")
            o = r["response"].get("output", [])
            calls = [json.loads(x.get("arguments") or "{}") for x in o if x.get("type") == "function_call" and x.get("name") == higgslive.TOOL]
            said = " ".join(p.get("text") or p.get("transcript") or "" for x in o if x.get("type") == "message" for p in x.get("content", []))
            out.append((calls, said))
            if calls and not said.strip():
                await send({"type": "response.create"}); r = await until("response.done")
        return out
async def main():
    for t1, t2, want in CASES:
        try: (c1, s1), (c2, s2) = await run(t1, t2)
        except Exception as e: print("FAIL", t2, repr(e)); continue
        got = bool(c2 and c2[0].get("replaces"))
        print(f"{'OK ' if got == want and c2 else 'BAD'} want={want} calls1={len(c1)} calls2={len(c2)} replaces={[c.get('replaces') for c in c2]} | {t2!r} -> {c2[0].get('task') if c2 else s2!r}")
asyncio.run(main())
