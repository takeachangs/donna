# /// script
# dependencies = ["websockets"]
# ///
# Open 1.5 sessions one at a time until one is refused (cap 25), then close all.
import asyncio, os, json, time, websockets
M = "higgs-realtime-1.5-preview"; H = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}
async def main():
    socks = []
    try:
        for n in range(1, 26):
            try:
                ws = await websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers=H)
                socks.append(ws)
                await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "output_modalities": ["text"]}}))
                e = json.loads(await asyncio.wait_for(ws.recv(), 10))
                print(n, time.strftime("%H:%M:%S"), e["type"], e.get("session", {}).get("id"), json.dumps(e.get("error", ""))[:200])
                if e["type"] != "session.created": break
            except websockets.ConnectionClosed as c: print(n, "CLOSED", c.rcvd and c.rcvd.code, c.rcvd and c.rcvd.reason); break
            except Exception as x: print(n, "FAIL", type(x).__name__, str(x)[:200]); break
        # are the earlier ones still alive?
        alive = 0
        for ws in socks:
            try: await asyncio.wait_for(ws.ping(), 5); alive += 1
            except Exception: pass
        print("still alive after test:", alive, "of", len(socks))
    finally:
        await asyncio.gather(*(ws.close() for ws in socks), return_exceptions=True)
asyncio.run(main())
