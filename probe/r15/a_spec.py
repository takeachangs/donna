# /// script
# dependencies = ["websockets>=13"]
# ///
"""Speculative calls: stream r.wav (15 s, task clear in the first 3 s) in real time with server_vad and delegate_task declared.
Prints a timeline (s since audio start) of VAD, transcription, response and function_call events.  uv run a_spec.py <model> <run>"""
import asyncio, base64, json, sys, time, wave
from a_tools import S, PROMPT, TOOL_DEF, MECHANICS
M, RUN = sys.argv[1], int(sys.argv[2])
pcm = wave.open("r.wav").readframes(10**9); CH = 24000 * 2 // 50   # 20 ms


async def main():
    async with S(M, "p2-spec", RUN) as s:
        fmt = {"type": "audio/pcm", "rate": 24000}
        await s.send({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": ["text"], "instructions": PROMPT + "\n\n" + MECHANICS,
            "tools": [TOOL_DEF], "tool_choice": "auto", "audio": {"input": {"format": fmt, "transcription": {"model": "higgs-stt-3.1"}, "turn_detection": {"type": "server_vad"}}}}})
        await s.until(lambda e: e["type"] == "session.created", 15)
        t0 = time.time()
        async def feed():   # absolute 20 ms clock, then 5 s silence
            chunks = [pcm[i:i + CH] for i in range(0, len(pcm), CH)] + [bytes(CH)] * 250
            for k, c in enumerate(chunks):
                await s.ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(c).decode()}))   # not logged: too big
                await asyncio.sleep(max(0, t0 + (k + 1) * 0.02 - time.time()))
        f = asyncio.create_task(feed())
        print(f"[{M} r{RUN}] speech ends at {len(pcm) / 48000:.2f}s")
        end = t0 + len(pcm) / 48000 + 10
        while time.time() < end:
            ev, _ = await s.until(lambda e: True, end - time.time())
            if not ev: break
            t, ts = ev["type"], round(time.time() - t0, 2)
            if t in ("response.output_text.delta",): continue
            info = ev.get("delta") or ev.get("transcript") or ev.get("text") or ""
            if t == "response.done":
                info = [(o.get("type"), o.get("name"), o.get("arguments")) if o.get("type") == "function_call" else (o.get("type"), " ".join(p.get("text") or p.get("transcript") or "" for p in o.get("content") or [])) for o in ev["response"].get("output", [])] + [ev["response"].get("status")]
            if t == "error": info = ev["error"].get("code")
            if t == "conversation.item.added": info = ev["item"].get("type")
            print(f"  {ts:6.2f} {t} {json.dumps(info)[:220] if info else ''}", flush=True)
        f.cancel()

asyncio.run(main())
