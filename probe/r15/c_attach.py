# /// script
# dependencies = ["websockets"]
# ///
# Can a second WebSocket attach to an existing session? Plus: is a `channels` format field honored? uv run c_attach.py <model>
import asyncio, os, sys, json, time, websockets
M = sys.argv[1] if len(sys.argv) > 1 else "higgs-realtime-1.5-preview"
LOG = open("C-session.jsonl", "a"); URL = "wss://api.boson.ai/v1/realtime?model=" + M
H = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}
SESS = {"type": "realtime", "model": M, "output_modalities": ["text"], "instructions": "Answer in one short sentence."}

async def recv_until(ws, stop, tag, tmo=15):
    txt = ""
    try:
        while True:
            e = json.loads(await asyncio.wait_for(ws.recv(), tmo)); t = e["type"]
            LOG.write(json.dumps({"probe": f"attach {M} {tag}", **e}) + "\n")
            if t == "response.output_text.done": txt = e.get("text", "")
            if t == "error": print(f"  [{tag}] error {e['error'].get('message')}")
            if t == stop: return e, txt
    except asyncio.TimeoutError: print(f"  [{tag}] timeout waiting for {stop}"); return None, txt

async def ask(ws, q, tag):
    await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": q}]}}))
    await recv_until(ws, "conversation.item.added", tag)
    await ws.send(json.dumps({"type": "response.create"}))
    return (await recv_until(ws, "response.done", tag))[1]

async def main():
    async with websockets.connect(URL, additional_headers=H, max_size=None) as ws1:
        await ws1.send(json.dumps({"type": "session.update", "session": SESS}))
        e, _ = await recv_until(ws1, "session.created", "ws1"); sid = e["session"]["id"]
        print("ws1 session.id =", sid, "| keys:", sorted(e["session"].keys()))
        print("ws1:", await ask(ws1, "Remember this: the secret word is PINEAPPLE. Just say OK.", "ws1"))
        variants = [("?session=", URL + "&session=" + sid, {}), ("?session_id=", URL + "&session_id=" + sid, {}),
                    ("hdr X-Session-Id", URL, {"X-Session-Id": sid}), ("hdr Session-Id", URL, {"Session-Id": sid}),
                    ("hdr OpenAI-Session", URL, {"OpenAI-Session": sid})]
        for name, url, extra in variants:
            try:
                async with websockets.connect(url, additional_headers={**H, **extra}, max_size=None) as ws2:
                    await ws2.send(json.dumps({"type": "session.update", "session": SESS}))
                    e2, _ = await recv_until(ws2, "session.created", name)
                    sid2 = e2 and e2["session"]["id"]
                    a = await ask(ws2, "What is the secret word? If you do not know, say UNKNOWN.", name)
                    print(f"{name}: session.id={sid2} same={sid2 == sid} answer={a!r}")
            except Exception as x: print(f"{name}: connect failed {type(x).__name__}: {x}")
        print("ws1 still alive:", await ask(ws1, "What is the secret word?", "ws1"))
    # channels: does the format echo / accept a channels field?
    async with websockets.connect(URL, additional_headers=H, max_size=None) as ws3:
        s = dict(SESS, audio={"input": {"format": {"type": "audio/pcm", "rate": 24000, "channels": 2}}, "output": {"format": {"type": "audio/pcm", "rate": 24000, "channels": 2}}})
        await ws3.send(json.dumps({"type": "session.update", "session": s}))
        e, _ = await recv_until(ws3, "session.created", "channels")
        print("channels echo:", json.dumps(e and e["session"].get("audio", {}).get("input", {}).get("format")), json.dumps(e and e["session"].get("audio", {}).get("output", {}).get("format")))
asyncio.run(main())
