# /// script
# dependencies = ["websockets"]
# ///
# Audio format probe: uv run c_fmt.py <model> <fmt>   fmt = pcmu | 8000 | 16000 | 24000 | 48000 | opus
# Feeds q.wav converted to <fmt> through server_vad, then reads back output audio and measures it.
import asyncio, os, sys, json, base64, time, collections, websockets
M, F = sys.argv[1], sys.argv[2]
LOG = open("C-session.jsonl", "a")
if F == "pcmu": fmt, bps, raw = {"type": "audio/pcmu"}, 8000, open("q_pcmu.raw", "rb").read()
elif F == "opus": fmt, bps, raw = {"type": "audio/opus"}, None, None
else: fmt, bps, raw = {"type": "audio/pcm", "rate": int(F)}, int(F) * 2, open(f"q_{F}.raw", "rb").read()
SIL = b"\xff" if F == "pcmu" else b"\x00"   # mu-law silence is 0xFF

def opus_packets(path):   # ponytail: minimal ogg demux, skips the 2 header packets
    d, pk, cur, i = open(path, "rb").read(), [], b"", 0
    while i < len(d):
        n = d[i + 26]; segs = d[i + 27:i + 27 + n]; j = i + 27 + n
        for s in segs:
            cur += d[j:j + s]; j += s
            if s < 255: pk.append(cur); cur = b""
        i = j
    return pk[2:]

async def main():
    out, counts, t0, sid = bytearray(), collections.Counter(), time.time(), None
    nout, transcript, intr = 0, "", ""
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None) as ws:
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "instructions": "You are a friendly voice assistant. Answer in two or three sentences.",
            "audio": {"input": {"format": fmt, "transcription": {"model": "higgs-stt-3.1"}, "turn_detection": {"type": "server_vad"}}, "output": {"format": json.loads(os.environ["OUTFMT"]) if os.environ.get("OUTFMT") else fmt, "voice": "default"}}}}))
        async def feed():
            await asyncio.sleep(0.5)
            if F == "opus":
                pk = opus_packets("q.opus")
                for p in pk: await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(p).decode()})); await asyncio.sleep(0.02)
                sil = opus_packets("sil.opus")
                for p in sil: await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(p).decode()})); await asyncio.sleep(0.02)
                return
            ch = bps // 50
            for i in range(0, len(raw), ch): await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(raw[i:i + ch]).decode()})); await asyncio.sleep(0.02)
            for _ in range(150): await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(SIL * ch).decode()})); await asyncio.sleep(0.02)
        f = asyncio.create_task(feed())
        try:
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 15)); t = e["type"]; counts[t] += 1
                if t == "response.output_audio.delta":
                    b = base64.b64decode(e["delta"]); out += b; nout += 1
                    if nout <= 2: print(f"  delta#{nout} {len(b)} bytes, first 8: {b[:8].hex()}")
                    continue
                LOG.write(json.dumps({"probe": f"fmt {M} {F}", "t": round(time.time() - t0, 2), **e}) + "\n")
                if t == "session.created": sid = e.get("session", {}).get("id"); print("session.created audio:", json.dumps(e.get("session", {}).get("audio"))[:300])
                if t == "session.updated": print("session.updated audio:", json.dumps(e.get("session", {}).get("audio"))[:300])
                if t == "conversation.item.input_audio_transcription.completed": intr = e.get("transcript")
                if t == "response.output_audio_transcript.done": transcript = e.get("transcript", "")
                if t.endswith(".delta"): continue
                info = e.get("transcript") or e.get("error") or ""
                print(f"{time.time()-t0:5.2f} {t} {json.dumps(info)[:200] if info else ''}")
                if t == "response.done": break
        except asyncio.TimeoutError: print("timeout (15s quiet)")
        f.cancel()
    ext = "opus.bin" if F == "opus" else "raw"
    open(f"out_C_{M}_{F}.{ext}", "wb").write(out)
    z = out.count(0) / max(len(out), 1); ff = (out.count(0xff) + out.count(0x7f)) / max(len(out), 1)
    print(f"RESULT {M} {F}: in_transcript={intr!r} out_bytes={len(out)} deltas={nout} chars={len(transcript)} bytes/char={len(out)/max(len(transcript),1):.0f}"
          + (f" implied_sec={len(out)/bps:.1f}" if bps else "") + f" frac00={z:.3f} fracFF7F={ff:.3f}")
    print(dict(counts))
asyncio.run(main())
