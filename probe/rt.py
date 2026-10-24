# /// script
# dependencies = ["websockets>=13"]
# ///
"""Probe: open a realtime session with a given model, send session.update (+ optional extras), print every event for N seconds."""
import asyncio, json, os, sys, time
import websockets

MODEL = sys.argv[1]
EXTRA = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
SECS = float(sys.argv[3]) if len(sys.argv) > 3 else 8

async def main():
    url = f"wss://api.boson.ai/v1/realtime?model={MODEL}"
    hdr = {"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}
    try:
        ws = await websockets.connect(url, additional_headers=hdr, max_size=None)
    except Exception as e:
        print("CONNECT FAIL:", repr(e)); return
    sess = {"type": "realtime", "model": MODEL, **EXTRA}
    await ws.send(json.dumps({"type": "session.update", "session": sess}))
    print("sent session.update", json.dumps(sess))
    t0 = time.time()
    try:
        while time.time() - t0 < SECS:
            msg = await asyncio.wait_for(ws.recv(), timeout=SECS - (time.time() - t0))
            ev = json.loads(msg)
            s = json.dumps(ev)
            print(f"[{time.time()-t0:5.2f}s]", s[:1500])
    except asyncio.TimeoutError:
        print("(timeout, no more events)")
    except websockets.ConnectionClosed as e:
        print("CLOSED:", e.code, e.reason)
    finally:
        await ws.close()

asyncio.run(main())
