# /// script
# dependencies = ["websockets"]
# ///
# Is session.created unprompted? Does the FIRST session.update get session.updated? uv run c_created.py <model>
import asyncio, os, sys, json, time, websockets
M = sys.argv[1] if len(sys.argv) > 1 else "higgs-realtime-1.5-preview"
LOG = open("C-session.jsonl", "a")
async def main():
    t0 = time.time()
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}) as ws:
        async def drain(sec):
            try:
                while True:
                    e = json.loads(await asyncio.wait_for(ws.recv(), sec)); LOG.write(json.dumps({"probe": f"created {M}", **e}) + "\n")
                    print(f"{time.time()-t0:5.2f} {e['type']} instr={e.get('session', {}).get('instructions')!r} mod={e.get('session', {}).get('output_modalities')}")
            except asyncio.TimeoutError: pass
        print("-- connect, send nothing"); await drain(5)
        for n, ins in enumerate(["FIRST update", "SECOND update"]):
            print(f"-- {ins}"); await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "output_modalities": ["text"], "instructions": ins}})); await drain(4)
asyncio.run(main())
