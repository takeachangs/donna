# GPT-Live architecture post — notes (source: openai.com/index/continuous-voice-interaction-with-gpt-live, read 2026-10-23)

Infra post, not API docs. Full text: `gpt-live-post.md`. Condensed in our words; principle they state: "the voice must flow."

## What they built
- Full-duplex voice model: listens and speaks at once; NO turn detector in the audio path. (Higgs Realtime is still turn-based server_vad = the architecture they call "previous". We cannot change this; position honestly.)
- Media path (audio in/out) is a dedicated fast path. Delegation, tool use, persistence sit behind an **async RPC boundary**: a slow backend delays its own result but cannot stall audio. (= our run_task returning immediately + inject on done.)
- Media frontend rewritten Python asyncio → Go; new p95 = old p50. WebRTC transport; WARP cuts startup from 6 round trips to 1; "Instant Connect" pre-negotiates SDP.
- Stateful inference: long sessions, context compaction done by warming a replacement instance in parallel and cutting over with no audio gap.

## Delegation details (the part that maps to us)
- Budget = **time until the frontier model produces something useful**, not time to completion. Voice can cover briefly, "cannot hide an arbitrarily slow response."
- **Pre-warm**: at voice-session start, create the frontier inference session and prefill it with conversation context BEFORE the first delegation. Keep it for the whole call; stable session affinity + prompt caching.
- Tuned levers: reasoning effort, output limits, tool schemas, model↔tool round trips.
- Discrete turns from continuous speech: server infers who has the floor from partial transcripts + timing; newest message is provisional; two views — speculative (UI) and authoritative (logs). Assistant backchannels ("mm hmm") while the user talks do NOT become their own message; substantive interjections do.
- Product tie-in: ChatGPT desktop now lets Voice "control your computer and coordinate your agents" on this architecture. GPT-Live API "upcoming."

## Apply to our build
1. /call mode already matches pre-warm: the interactive Claude Code session is live and prefilled before the first task. In `--backend claude` mode we start cold → warm the session at connect (one cheap `claude -p "ready"` to create the session + cache CLAUDE.md), then `--resume` it.
2. Cut time-to-useful: backend on a faster model for the delegation (`claude -p --model sonnet`), tight allowedTools, and have the backend emit its plan as the first progress note so the voice has something concrete to say early.
3. Transcript display: mark the newest line provisional (STT partials) and finalize on `transcription.completed` — speculative vs authoritative, cheap to show in the terminal UI.
4. Pitch/write-up language: "decouple talking from thinking"; "voice coordinates your agent" — OpenAI shipped it for ChatGPT desktop, we do it for Higgs + Claude Code.
5. Honest limitation for judges: Higgs is turn-based (server VAD), so true overlap/backchannel is out of reach; we get barge-in only.
