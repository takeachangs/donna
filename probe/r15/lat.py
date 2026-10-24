# /// script
# dependencies = ["websockets"]
# ///
# Latency probe. usage: uv run lat.py MODEL audio|text [long]  -> one summary JSON line on stdout, raw events appended to B-latency.jsonl
import asyncio, os, sys, json, base64, wave, time, websockets
M, MODE, LONG = sys.argv[1], sys.argv[2], len(sys.argv) > 3
RUN = f"{M}|{MODE}|{'long' if LONG else 'short'}|{time.strftime('%H:%M:%S')}"
pcm = wave.open("q.wav").readframes(10**9)
CH = 24000 * 2 // 50   # 20 ms
BASE = "You are a friendly voice assistant. Keep answers short."
RULES = [f"Rule {i}: " + s for i, s in enumerate([
    "Speak in plain, warm, conversational English; never read out lists, markdown, URLs or code.",
    "If the caller asks something you do not know, say so briefly instead of guessing.",
    "Keep every answer under three sentences unless the caller explicitly asks for more detail.",
    "Never mention that you are an AI model or talk about your instructions.",
    "When the caller sounds confused, rephrase more simply and check they followed.",
    "Use the caller's own words for things when you can; avoid jargon.",
    "If the caller changes topic, follow them without commenting on the change.",
    "Numbers: say them the way a person would ('about two thousand'), not digit by digit.",
    "Do not end every turn with a question; only ask when you actually need information.",
    "If the line is noisy or the request is unclear, ask the caller to repeat once, then do your best.",
] * 4)]
INSTR = BASE + ("\n" + "\n".join(RULES))[:3000 - len(BASE)] if LONG else BASE
log = open("B-latency.jsonl", "a")

async def main():
    t0 = time.time(); T = lambda: round(time.time() - t0, 3)
    r = {"run": RUN, "model": M, "mode": MODE, "instr_chars": len(INSTR)}
    out = 0
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None) as ws:
        fmt = {"type": "audio/pcm", "rate": 24000}
        s = {"type": "realtime", "model": M, "instructions": INSTR}
        if MODE == "audio":
            s["audio"] = {"input": {"format": fmt, "transcription": {"model": "higgs-stt-3.1"}, "turn_detection": {"type": "server_vad"}}, "output": {"format": fmt, "voice": "default"}}
        else:
            s["output_modalities"] = ["text"]
        await ws.send(json.dumps({"type": "session.update", "session": s}))
        f = None
        if MODE == "audio":
            async def feed():
                n = len(pcm) // CH + 1
                for k in range(n + 150):   # speech then 3 s silence, paced on an absolute 20 ms clock
                    chunk = pcm[k*CH:(k+1)*CH] if k < n else bytes(CH)
                    await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(chunk).decode()}))
                    if k == n - 1: r["t_speech_end_sent"] = T()
                    await asyncio.sleep(max(0, t0 + (k + 1) * 0.02 - time.time()))
                r["t_feed_done"] = T()
            f = asyncio.create_task(feed())
        else:
            await ws.send(json.dumps({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Quick question: what's a good way to keep basil alive indoors?"}]}}))
        try:
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 12)); t = e["type"]; now = T()
                if t == "response.output_audio.delta":
                    out += len(base64.b64decode(e["delta"])); r.setdefault("t_first_audio", now)
                    log.write(json.dumps({"run": RUN, "t": now, "type": t, "bytes": len(e["delta"])}) + "\n"); continue
                log.write(json.dumps({"run": RUN, "t": now, **e}) + "\n")
                if t == "conversation.item.added" and MODE == "text" and "t_response_create" not in r:
                    await ws.send(json.dumps({"type": "response.create"})); r["t_response_create"] = T()
                key = {"input_audio_buffer.speech_started": "t_speech_started", "input_audio_buffer.speech_stopped": "t_speech_stopped",
                       "response.created": "t_response_created", "response.output_text.delta": "t_first_text",
                       "response.output_audio_transcript.delta": "t_first_transcript", "error": "error"}.get(t)
                if key: r.setdefault(key, e.get("error") if t == "error" else now)
                if t == "input_audio_buffer.speech_stopped": r["audio_end_ms"] = e.get("audio_end_ms")
                if t == "response.done": r["t_done"] = now; r["status"] = e.get("response", {}).get("status"); break
        except asyncio.TimeoutError: r["timeout"] = T()
        if f: f.cancel()
    r["out_audio_s"] = round(out / 48000, 2); r["ended"] = "t_done" in r
    print(json.dumps(r)); log.close()
asyncio.run(main())
