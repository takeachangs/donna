# /// script
# dependencies = ["websockets"]
# ///
# What resets the idle timer / when does max_duration fire? uv run c_idle.py <mode> [model]
# modes: none | sil (silence appends, one q.wav speech at 120 s) | upd (no-op session.update every 60 s)
#        text (user text item every 120 s, no response) | asst (audio out, ~long answer) | maxdur (q.wav every 240 s, stop at 31 min)
import asyncio, os, sys, json, base64, time, websockets
MODE = sys.argv[1]; M = sys.argv[2] if len(sys.argv) > 2 else "higgs-realtime-1.5-preview"
LOG = open(f"C-idle-{MODE}.jsonl", "w"); OUT = open(f"C-idle-{MODE}.txt", "w", buffering=1)
pcm = open("q_24000.raw", "rb").read(); CH = 960; SIL = bytes(CH)
def say(*a): print(*a, file=OUT)

async def main():
    t0 = time.time(); T = lambda: round(time.time() - t0, 1)
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None) as ws:
        mods = ["audio"] if MODE == "asst" else ["text"]
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "output_modalities": mods,
            "instructions": "You are a friendly assistant.", "audio": {"input": {"turn_detection": {"type": "server_vad"}}}}}))
        async def send(e): await ws.send(json.dumps(e))
        async def text_turn(q, respond=True):
            await send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": q}]}})
            if respond: await asyncio.sleep(1); await send({"type": "response.create"})
        async def speech():
            for i in range(0, len(pcm), CH): await send({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm[i:i + CH]).decode()}); await asyncio.sleep(0.02)
        async def driver():
            await asyncio.sleep(2)
            if MODE == "asst": await text_turn("Tell me a detailed story about a lighthouse keeper, at least 150 words."); return
            await text_turn("Say hi in three words.")
            if MODE == "sil":
                n = 0
                while True:
                    if n == 6000: say(T(), "SPEECH q.wav start"); await speech(); say(T(), "SPEECH end")
                    await send({"type": "input_audio_buffer.append", "audio": base64.b64encode(SIL).decode()}); await asyncio.sleep(0.02); n += 1
            if MODE == "upd":
                while True: await asyncio.sleep(60); await send({"type": "session.update", "session": {"temperature": 0.3}}); say(T(), "sent no-op update")
            if MODE == "text":
                while True: await asyncio.sleep(120); await text_turn("(just a note, no reply needed)", respond=False); say(T(), "sent text item")
            if MODE == "maxdur":
                while True:
                    await asyncio.sleep(240); say(T(), "SPEECH"); await speech()
                    for _ in range(100): await send({"type": "input_audio_buffer.append", "audio": base64.b64encode(SIL).decode()}); await asyncio.sleep(0.02)
        d = asyncio.create_task(driver()); first_audio = None; abytes = 0
        try:
            while True:
                e = json.loads(await asyncio.wait_for(ws.recv(), 2000)); t = e["type"]
                if t == "response.output_audio.delta":
                    abytes += len(base64.b64decode(e["delta"])); first_audio = first_audio or T(); continue
                if t.endswith(".delta"): continue
                LOG.write(json.dumps({"t": T(), **e}) + "\n"); LOG.flush()
                x = {k: v for k, v in e.items() if k not in ("type", "event_id", "session", "item", "response", "part")}
                say(T(), t, json.dumps(x)[:200])
                if t == "response.done" and abytes: say(T(), f"  audio {abytes/48000:.1f}s, first delta at {first_audio}, playback would end at {first_audio + abytes/48000:.1f}")
                if MODE == "maxdur" and time.time() - t0 > 31 * 60: say(T(), "STOP at 31 min, no max_duration event"); break
        except websockets.ConnectionClosed as c: say(T(), f"CLOSED code={c.rcvd and c.rcvd.code} reason={c.rcvd and c.rcvd.reason!r}")
        except asyncio.TimeoutError: say(T(), "recv timeout")
        d.cancel()
asyncio.run(main())
