# /// script
# dependencies = ["websockets"]
# ///
# Second session.update sent before session.created arrives: applied, merged, or dropped?
import asyncio, os, json, time, websockets
M = "higgs-realtime-1.5-preview"
async def main():
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "output_modalities": ["text"], "instructions": "Always answer in French.", "temperature": 0.7}}))
        await ws.send(json.dumps({"type": "session.update", "session": {"audio": {"output": {"voice": "jake"}}}}))
        try:
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 5)); s = e.get("session", {})
                print(e["type"], "instr=", s.get("instructions"), "temp=", s.get("temperature"), "voice=", s.get("audio", {}).get("output", {}).get("voice"), e.get("error", ""))
        except asyncio.TimeoutError: pass
        await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "What color is the sky?"}]}}))
        await asyncio.sleep(1); await ws.send(json.dumps({"type": "response.create"}))
        try:
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if e["type"] in ("response.output_text.done", "error"): print(e["type"], e.get("text") or e.get("error"))
                if e["type"] == "response.done": break
        except asyncio.TimeoutError: print("timeout")
asyncio.run(main())
