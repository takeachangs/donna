# Summarize B-runs.jsonl into a markdown table. usage: python3 B-summ.py
import json, statistics as st
rows = [json.loads(l) for l in open("B-runs.jsonl") if l.strip()]
def ms(xs): return f"{st.median(xs):.2f} [{min(xs):.2f}–{max(xs):.2f}]" if xs else "–"
print("| model | mode | instr | N | ended | no stopped / no created / no done | speech end→stopped (VAD) | speech end→1st audio (user wait) | stopped→1st audio | 1st audio→done (gen time, not speaking time) | out audio s | create→1st text | create→done |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
groups = {}
for r in rows: groups.setdefault((r["model"], r["mode"], r["instr_chars"]), []).append(r)
for (m, mode, ic), g in sorted(groups.items(), key=lambda k: (k[0][1], k[0][2], k[0][0])):
    ok = [r for r in g if r["ended"] and "t_first_audio" in r]
    tx = [r for r in g if r["ended"] and "t_first_text" in r]
    print(f"| {m} | {mode} | {ic} | {len(g)} | {sum(r['ended'] for r in g)}/{len(g)} "
          f"| {sum('t_speech_stopped' not in r for r in g) if mode=='audio' else '-'}/{sum('t_response_created' not in r for r in g)}/{sum('t_done' not in r for r in g)} "
          f"| {ms([r['t_speech_stopped']-r['t_speech_end_sent'] for r in g if 't_speech_stopped' in r and 't_speech_end_sent' in r])} "
          f"| {ms([r['t_first_audio']-r['t_speech_end_sent'] for r in ok if 't_speech_end_sent' in r])} "
          f"| {ms([r['t_first_audio']-r['t_speech_stopped'] for r in ok if 't_speech_stopped' in r])} "
          f"| {ms([r['t_done']-r['t_first_audio'] for r in ok])} | {ms([r['out_audio_s'] for r in ok])} "
          f"| {ms([r['t_first_text']-r['t_response_create'] for r in tx])} | {ms([r['t_done']-r['t_response_create'] for r in tx])} |")
print("\nFailed runs:"); [print("-", json.dumps(r)) for r in rows if not r["ended"]]
