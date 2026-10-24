"""Open session with MODEL, send a text user message + response.create, summarize every event type (count, total payload bytes)."""
import asyncio, json, os, sys, time, collections
import websockets
MODEL = sys.argv[1]; SECS = 20
async def main():
    ws = await websockets.connect(f"wss://api.boson.ai/v1/realtime?model={MODEL}", additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None)
    await ws.send(json.dumps({"type":"session.update","session":{"type":"realtime","model":MODEL,"output_modalities":["audio"]}}))
    await ws.send(json.dumps({"type":"conversation.item.create","item":{"type":"message","role":"user","content":[{"type":"input_text","text":"Say hello in one short sentence."}]}}))
    await ws.send(json.dumps({"type":"response.create"}))
    kinds = collections.Counter(); size = collections.Counter(); t0=time.time(); first={}
    try:
        while time.time()-t0 < SECS:
            msg = await asyncio.wait_for(ws.recv(), timeout=SECS-(time.time()-t0)); ev=json.loads(msg); t=ev["type"]
            kinds[t]+=1; size[t]+=len(msg); first.setdefault(t, round(time.time()-t0,2))
            if t in ("error",): print("ERROR:", ev)
            if t=="response.done": print("response.done status:", ev["response"].get("status"), "output types:", [o.get("type") for o in ev["response"].get("output",[])]); break
            if t.startswith("session."): print(t, "keys:", sorted(ev["session"].keys()) if "session" in ev else ev)
    except asyncio.TimeoutError: print("(timeout)")
    except websockets.ConnectionClosed as e: print("CLOSED", e.code, e.reason)
    for k in kinds: print(f"  {k:50s} n={kinds[k]:4d} bytes={size[k]:8d} first@{first[k]}s")
    await ws.close()
asyncio.run(main())
