# Summarize B2-runs.jsonl (bt.py output). usage: python3 B2-summ.py
import json, statistics as st
rows = [json.loads(l) for l in open("B2-runs.jsonl") if l.strip()]
def ms(xs): return f"{st.median(xs):.2f} [{min(xs):.2f}–{max(xs):.2f}]" if xs else "–"
short = lambda m: "1.5" if "1.5" in m else "1.0"
def first(r, typ, after=-1): return next((t for t, ty, _ in r["events"] if ty == typ and t > after), None)

print("### Turn end: VAD variants and manual commit (one turn, continuous simulated mic)\n")
print("| model | turn_detection | N | no reply | ended early (stopped before clip end) | extra turns | caller wait: clip end→1st audio | commit→1st audio |")
print("|---|---|---|---|---|---|---|---|")
g = {}
for r in rows:
    if r["mode"] in ("vad", "manual"): g.setdefault((short(r["model"]), json.dumps(r["td"])), []).append(r)
for (m, td), rs in sorted(g.items()):
    ok = [r for r in rs if r["responses"] and "first" in r["responses"][0]]
    early = sum(any(ty == "input_audio_buffer.speech_stopped" and t < (r["speech_ends"] or [5.18])[0] for t, ty, _ in r["events"]) for r in rs)
    print(f"| {m} | `{td}` | {len(rs)} | {len(rs)-len(ok)} | {early} | {sum(max(0, len(r['responses'])-1) for r in rs)} "
          f"| {ms([r['responses'][0]['first'] - (r['speech_ends'] or [5.18])[0] for r in ok])} | {ms([r['responses'][0]['first'] - r['t_commit'] for r in ok if 't_commit' in r])} |")

print("\n### Barge-in (q.wav replayed once 1.5 s of reply audio had arrived)\n")
print("| model | N | resp1 status | barge speech→speech_started | speech_started→last resp1 delta | speech_started→resp1 done | resp1 audio delivered s | stored resp1 text (item.retrieve) | truncated event |")
print("|---|---|---|---|---|---|---|---|---|")
for m in ("1.0", "1.5"):
    rs = [r for r in rows if r["mode"] == "barge" and short(r["model"]) == m]
    if not rs: continue
    S = lambda r: first(r, "input_audio_buffer.speech_started", r["t_act"])
    v = [r for r in rs if S(r) is not None and r["responses"]]
    print(f"| {m} | {len(rs)} | {', '.join(str(r['responses'][0].get('status')) for r in rs)} | {ms([S(r) - r['t_act'] for r in v])} "
          f"| {ms([r['responses'][0]['last'] - S(r) for r in v])} | {ms([r['responses'][0]['t_done'] - S(r) for r in v if 't_done' in r['responses'][0]])} "
          f"| {ms([r['responses'][0]['bytes'] for r in v])} | {' / '.join(repr(((r.get('retrieved') or [{}])[0]).get('text')) for r in rs)} "
          f"| {sum(any(ty == 'conversation.item.truncated' for _, ty, _ in r['events']) for r in rs)}/{len(rs)} |")

print("\n### Client response.cancel at the same point\n")
print("| model | N | status | cancel→last delta | cancel→response.done | audio delivered s |")
print("|---|---|---|---|---|---|")
for m in ("1.0", "1.5"):
    rs = [r for r in rows if r["mode"] == "cancel" and short(r["model"]) == m]
    if not rs: continue
    c = lambda r: first(r, "SENT response.cancel")
    print(f"| {m} | {len(rs)} | {', '.join(str(r['responses'][0].get('status')) for r in rs)} | {ms([r['responses'][0]['last'] - c(r) for r in rs])} "
          f"| {ms([r['responses'][0]['t_done'] - c(r) for r in rs if 't_done' in r['responses'][0]])} | {ms([r['responses'][0]['bytes'] for r in rs])} |")

print("\nErrors/timeouts:"); [print("-", r["run"], r.get("timeout"), [e for e in r["events"] if e[1] == "error"]) for r in rows if r.get("timeout") or any(e[1] == "error" for e in r["events"])]
print("\nBarge resp2 transcripts:"); [print("-", short(r["model"]), repr(r["responses"][-1].get("transcript"))) for r in rows if r["mode"] == "barge"]
