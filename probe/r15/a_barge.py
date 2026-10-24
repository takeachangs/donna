# /// script
# dependencies = ["websockets>=13"]
# ///
"""Pending delegate_task vs barge-in, audio mode.  uv run a_barge.py <model> <run>
spoken task (t.wav) → call → bare ack → barge in with q.wav on the ack's first audio delta → Canberra answer → text turn →
item.retrieve the call → output at ~30 s → bare response.create → recall turn."""
import asyncio, base64, json, sys, time, wave
from a_tools import S, PROMPT, TOOL_DEF, MECHANICS
M, RUN = sys.argv[1], int(sys.argv[2])
CH = 24000 * 2 // 50   # 20 ms
clip = lambda f: wave.open(f).readframes(10**9)
TASK, Q = clip("t.wav"), clip("q.wav")


class A(S):
    def log(self, d, ev):   # keep the log small: no audio payloads
        if "delta" in ev and "audio" in ev.get("type", ""): ev = {**ev, "delta": len(ev["delta"])}
        super().log(d, ev)


def p(*a): print(*a, flush=True)


async def main():
    async with A(M, "p3-barge", RUN) as s:
        fmt = {"type": "audio/pcm", "rate": 24000}
        await s.send({"type": "session.update", "session": {"type": "realtime", "model": M, "instructions": PROMPT + "\n\n" + MECHANICS, "tools": [TOOL_DEF], "tool_choice": "auto",
            "audio": {"input": {"format": fmt, "transcription": {"model": "higgs-stt-3.1"}, "turn_detection": {"type": "server_vad"}}, "output": {"format": fmt, "voice": "default"}}}})
        await s.until(lambda e: e["type"] == "session.created", 15)
        t0, play = time.time(), asyncio.Queue()
        async def mic():   # a real mic: silence on a 20 ms clock, clips spliced in when queued
            buf, k = b"", 0
            while True:
                if not buf and not play.empty(): buf = await play.get()
                c, buf = (buf[:CH], buf[CH:]) if buf else (bytes(CH), b"")
                await s.ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(c.ljust(CH, b"\0")).decode()}))
                k += 1; await asyncio.sleep(max(0, t0 + k * 0.02 - time.time()))
        m = asyncio.create_task(mic())
        T = lambda: f"{time.time() - t0:6.2f}"
        call_errs = lambda seen, cid: [e for e in seen if e["type"] == "error" or (cid and cid in json.dumps(e) and e["type"] not in ("response.done", "conversation.item.added", "response.output_item.added", "response.output_item.done", "response.function_call_arguments.delta", "response.function_call_arguments.done"))]
        try:
            await play.put(TASK)
            done, seen = await s.until(lambda e: e["type"] == "response.done", 30)
            calls = [o for o in (done or {}).get("response", {}).get("output", []) if o.get("type") == "function_call"]
            p(f"[{M} r{RUN}] {T()} T0 calls={[(c['name'], c['arguments']) for c in calls]} errs={[e.get('error') for e in seen if e['type'] == 'error']}")
            if not calls: p("  NO CALL, abort"); return
            call = calls[0]; cid, iid, t_call = call["call_id"], call["id"], time.time()
            await s.send({"type": "response.create"})   # bare ack
            ev, seen = await s.until(lambda e: e["type"] in ("response.output_audio.delta", "response.done"), 20)
            p(f"  {T()} ack first event: {ev and ev['type']}")
            await play.put(Q)   # barge in while the ack streams
            seen_all = list(seen); ack_status = None; ans = None
            while True:   # until the auto reply to q.wav is done
                ev, seen = await s.until(lambda e: e["type"] in ("response.done", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "error"), 25)
                seen_all += seen
                if not ev: p(f"  {T()} timeout waiting"); break
                if ev["type"] != "response.done": p(f"  {T()} {ev['type']} {ev.get('error', '')}"); continue
                st, out = ev["response"]["status"], ev["response"].get("output", [])
                txt = " ".join(c.get("transcript") or c.get("text") or "" for o in out for c in o.get("content") or [])
                fc = [(o["name"], o["arguments"]) for o in out if o.get("type") == "function_call"]
                p(f"  {T()} response.done status={st} {ev['response'].get('status_details')} calls={fc} text={txt[:160]!r}")
                if ack_status is None: ack_status = st; continue
                ans = txt; break
            p(f"  call-related errors/cancels so far: {[(e['type'], e.get('error')) for e in call_errs(seen_all, cid)]}")
            async def retrieve(tag):
                await s.send({"type": "conversation.item.retrieve", "item_id": iid})
                ev, _ = await s.until(lambda e: e["type"] in ("conversation.item.retrieved", "error"), 5)
                it = (ev or {}).get("item", {})
                p(f"  {T()} retrieve[{tag}] {ev and ev['type']} status={it.get('status')} call_id_match={it.get('call_id') == cid} {ev.get('error', '') if ev else ''}")
            await retrieve("after barge")
            text, calls2, errs, dt = await s.user("Cool. Tell me a one-line joke about cats.")
            p(f"  {T()} TEXT TURN calls={calls2} errs={errs} text={text[:120]!r}")
            await retrieve("before output")
            await asyncio.sleep(max(0, 30 - (time.time() - t_call)))
            ack = await s.item({"type": "function_call_output", "call_id": cid, "output": "Created notes.txt in the sandbox folder containing: 2026-10-23."})
            p(f"  {T()} OUTPUT {time.time() - t_call:.0f}s after call; ack={ack and ack['type']} {ack.get('error', '') if ack else ''}")
            text, calls2, errs, dt = await s.respond()
            p(f"  {T()} RESULT calls={calls2} errs={errs} text={text[:200]!r}")
            text, calls2, errs, dt = await s.user("Sorry, what exactly did you put in that notes file?")
            p(f"  {T()} RECALL calls={calls2} errs={errs} text={text[:200]!r}")
        finally:
            m.cancel()

asyncio.run(main())
