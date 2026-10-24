# /// script
# dependencies = ["websockets"]
# ///
import asyncio, os, sys, json, base64, wave, time, websockets, collections
M = sys.argv[1] if len(sys.argv) > 1 else "higgs-realtime-1.5-preview"
pcm = wave.open("q.wav").readframes(10**9)
CH = 24000 * 2 // 50   # 20 ms
async def main():
    out, counts, t0 = bytearray(), collections.Counter(), time.time()
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None) as ws:
        fmt = {"type": "audio/pcm", "rate": 24000}
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "instructions": "You are a friendly voice assistant. Keep answers short.",
            "audio": {"input": {"format": fmt, "transcription": {"model": "higgs-stt-3.1"}, "turn_detection": {"type": "server_vad"}}, "output": {"format": fmt, "voice": "default"}}}}))
        async def feed():
            for i in range(0, len(pcm), CH):
                await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm[i:i+CH]).decode()})); await asyncio.sleep(0.02)
            for _ in range(150):   # 3 s silence, like a real mic
                await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(bytes(CH)).decode()})); await asyncio.sleep(0.02)
            print(f"{time.time()-t0:5.2f} [audio sent: {len(pcm)/48000:.1f}s speech + 3s silence]")
        f = asyncio.create_task(feed())
        try:
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 15)); t = e["type"]; counts[t] += 1
                if t == "response.output_audio.delta": out += base64.b64decode(e["delta"]); continue
                if t.endswith(".delta"): continue
                info = e.get("transcript") or e.get("error") or ""
                print(f"{time.time()-t0:5.2f} {t} {json.dumps(info)[:200] if info else ''}")
                if t == "response.done": await asyncio.sleep(0.5); break
        except asyncio.TimeoutError: print("timeout (15s quiet)")
        f.cancel()
    w = wave.open(f"out_{M}.wav", "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(out); w.close()
    print(f"output audio: {len(out)/48000:.1f}s ->", f"out_{M}.wav"); print(dict(counts))
asyncio.run(main())
