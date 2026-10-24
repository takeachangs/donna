# /// script
# dependencies = ["websockets", "numpy"]
# ///
# Mid-call session.update: does an instructions / voice change take effect on the next turn? uv run c_update.py <model>
import asyncio, os, sys, json, base64, time, websockets, numpy as np
M = sys.argv[1] if len(sys.argv) > 1 else "higgs-realtime-1.5-preview"
LOG = open("C-session.jsonl", "a")
STEPS = [  # (session patch sent before the turn, user text)
    ({"instructions": "Always answer in French, one short sentence.", "audio": {"output": {"voice": "default"}}}, "What is your favorite season?"),
    ({"instructions": "Always answer in Spanish, one short sentence.", "audio": {"output": {"voice": "jake"}}}, "What is your favorite food?"),
    ({"audio": {"output": {"voice": "no_such_voice_xyz"}}}, "What is your favorite animal?"),
]

def pitch(pcm):   # ponytail: crude autocorrelation F0 median over voiced 40 ms frames, enough to tell voices apart
    x = np.frombuffer(bytes(pcm), np.int16).astype(float); f0 = []
    for i in range(0, len(x) - 960, 960):
        fr = x[i:i + 960]
        if np.sqrt((fr ** 2).mean()) < 500: continue
        ac = np.correlate(fr, fr, "full")[959:]; lo, hi = 24000 // 400, 24000 // 70
        f0.append(24000 / (lo + ac[lo:hi].argmax()))
    return round(float(np.median(f0))) if f0 else None

async def main():
    t0 = time.time()
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None) as ws:
        async def recv_until(stop, tmo=20):
            audio, txt = bytearray(), ""
            try:
                while True:
                    e = json.loads(await asyncio.wait_for(ws.recv(), tmo)); t = e["type"]
                    if t == "response.output_audio.delta": audio += base64.b64decode(e["delta"]); continue
                    LOG.write(json.dumps({"probe": f"update {M}", "t": round(time.time() - t0, 2), **e}) + "\n")
                    if t.endswith(".delta"): continue
                    if t == "response.output_audio_transcript.done": txt = e["transcript"]
                    if t in ("error", "session.created", "session.updated"): print(f"  {time.time()-t0:5.2f} {t} {json.dumps(e.get('error') or e.get('session', {}).get('audio', {}).get('output'))[:250]}")
                    if t == stop: return audio, txt
            except asyncio.TimeoutError: print(f"  timeout waiting for {stop}"); return audio, txt
        base = {"type": "realtime", "model": M, "audio": {"input": {"turn_detection": {"type": "server_vad"}}}}
        for n, (patch, q) in enumerate(STEPS):
            s = dict(base, **patch) if n == 0 else patch
            await ws.send(json.dumps({"type": "session.update", "session": s}))
            if n == 0: await recv_until("session.created")
            else: await asyncio.sleep(1.0); print("  (sent mid-call update)")
            await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": q}]}}))
            await recv_until("conversation.item.added")
            await ws.send(json.dumps({"type": "response.create"}))
            audio, txt = await recv_until("response.done")
            print(f"TURN {n} patch={json.dumps(patch)[:90]} -> {txt!r} audio={len(audio)/48000:.1f}s medianF0={pitch(audio)}Hz")
asyncio.run(main())
