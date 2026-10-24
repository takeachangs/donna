# /// script
# dependencies = ["websockets"]
# ///
# N sessions, fire one text response in each at the same moment; count upstream_errors. uv run c_gen.py N
import asyncio, os, sys, json, websockets
M = "higgs-realtime"; H = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}; N = int(sys.argv[1])
async def one(i, go):
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers=H) as ws:
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "output_modalities": ["text"]}}))
        await ws.recv()
        await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Say hi in three words."}]}}))
        while json.loads(await ws.recv())["type"] != "conversation.item.added": pass
        await go.wait(); await ws.send(json.dumps({"type": "response.create"}))
        r = "?"
        while True:
            e = json.loads(await asyncio.wait_for(ws.recv(), 20))
            if e["type"] == "error": r = "ERR " + e["error"].get("code", "")
            if e["type"] == "response.output_text.done": r = "ok"
            if e["type"] == "response.done": return r
async def main():
    go = asyncio.Event(); ts = [asyncio.create_task(one(i, go)) for i in range(N)]
    await asyncio.sleep(6); go.set()
    rs = await asyncio.gather(*ts, return_exceptions=True); print(N, [str(r) for r in rs])
asyncio.run(main())
