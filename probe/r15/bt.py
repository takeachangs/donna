# /// script
# dependencies = ["websockets"]
# ///
# Phase-2 turn-taking probe. usage: uv run bt.py MODEL MODE [TURN_DETECTION_JSON]
#   MODE: vad (one turn) | barge (interrupt with q.wav after 1.5 s of reply audio) | cancel (response.cancel at same point) | manual (turn_detection null + commit)
# Mic is simulated continuously (silence when idle). Summary JSON line on stdout; raw events appended to B-latency.jsonl.
import asyncio, os, sys, json, base64, wave, time, websockets
M, MODE = sys.argv[1], sys.argv[2]
TD = None if MODE == "manual" else json.loads(sys.argv[3]) if len(sys.argv) > 3 else {"type": "server_vad"}
RUN = f"{M}|{MODE}|{json.dumps(TD)}|{time.strftime('%H:%M:%S')}"
pcm = wave.open("q.wav").readframes(10**9)
CH = 24000 * 2 // 50   # 20 ms
BARGE_BYTES = int(1.5 * 48000)
log = open("B-latency.jsonl", "a")

async def main():
    r = {"run": RUN, "model": M, "mode": MODE, "td": TD}
    ev, resp = [], {}          # ev: (t, type, extra); resp: response_id -> {first, last, bytes, status, transcript}
    queue = bytearray(pcm)     # audio waiting to be "spoken" into the mic
    async with websockets.connect("wss://api.boson.ai/v1/realtime?model=" + M, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None) as ws:
        t0 = time.time(); T = lambda: round(time.time() - t0, 3)
        fmt = {"type": "audio/pcm", "rate": 24000}
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "model": M, "instructions": "You are a friendly voice assistant. Keep answers short.",
            "audio": {"input": {"format": fmt, "transcription": {"model": "higgs-stt-3.1"}, "turn_detection": TD}, "output": {"format": fmt, "voice": "default"}}}}))
        speech_ends = []
        async def send(o): await ws.send(json.dumps(o)); ev.append((T(), "SENT " + o["type"], None))
        async def mic():
            k = 0
            while True:
                had = len(queue) > 0
                chunk = bytes(queue[:CH]).ljust(CH, b"\0"); del queue[:CH]
                await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(chunk).decode()}))
                if had and not queue:
                    speech_ends.append(T())
                    if MODE == "manual":   # client decides the turn is over
                        await send({"type": "input_audio_buffer.commit"}); r["t_commit"] = T()
                k += 1; await asyncio.sleep(max(0, t0 + k * 0.02 - time.time()))
        f = asyncio.create_task(mic())
        acted = False; end_at = None
        try:
            while True:
                tmo = 10 if end_at is None else max(0.01, end_at - time.time())
                try: e = json.loads(await asyncio.wait_for(ws.recv(), tmo))
                except asyncio.TimeoutError:
                    if end_at is None: r["timeout"] = T()
                    break
                t = e["type"]; now = T(); rid = e.get("response_id") or (e.get("response") or {}).get("id")
                if t == "response.output_audio.delta":
                    d = resp.setdefault(rid, {}); d.setdefault("first", now); d["last"] = now; d["bytes"] = d.get("bytes", 0) + len(base64.b64decode(e["delta"]))
                    log.write(json.dumps({"run": RUN, "t": now, "type": t, "response_id": rid}) + "\n")
                    if MODE in ("barge", "cancel") and not acted and d["bytes"] >= BARGE_BYTES:
                        acted = True; r["t_act"] = now
                        if MODE == "barge": queue[:] = pcm
                        else: await send({"type": "response.cancel"})
                    continue
                if t.endswith(".delta"): continue
                log.write(json.dumps({"run": RUN, "t": now, **e}) + "\n")
                ev.append((now, t, e.get("audio_start_ms", e.get("audio_end_ms"))))
                if t == "response.output_audio_transcript.done": resp.setdefault(rid, {})["transcript"] = e.get("transcript")
                if t == "response.output_item.added": resp.setdefault(rid, {})["item_id"] = e.get("item", {}).get("id")
                if t in ("conversation.item.added", "input_audio_buffer.committed") and MODE == "manual" and "t_commit" in r and "t_rc" not in r:
                    await send({"type": "response.create"}); r["t_rc"] = T()
                if t == "response.done":
                    resp.setdefault(rid, {})["status"] = e["response"].get("status"); resp[rid]["t_done"] = now
                    done_n = sum("status" in v for v in resp.values())
                    if end_at is None and (MODE in ("vad", "manual", "cancel") or done_n >= 2):
                        if MODE == "barge":   # what does the server store for the interrupted reply?
                            first = list(resp.values())[0]
                            if first.get("item_id"): await send({"type": "conversation.item.retrieve", "item_id": first["item_id"]})
                        end_at = time.time() + (3 if MODE != "barge" else 1.5)   # grace: catch a spurious extra turn
                if t == "conversation.item.retrieved": r["retrieved"] = e.get("item", {}).get("content")
        finally: f.cancel()
    r["speech_ends"] = speech_ends; r["events"] = [x for x in ev if not x[1].startswith("conversation.item.input_audio_transcription")]
    r["responses"] = [{"id": k, **{kk: (round(vv / 48000, 2) if kk == "bytes" else vv) for kk, vv in v.items()}} for k, v in resp.items()]
    print(json.dumps(r)); log.close()
asyncio.run(main())
