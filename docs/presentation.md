# Donna: 10-minute presentation run of show

Two presenters. S = Seongmin (the phone, the layer), J = Jerrold (the office, the scene). Slides are one line of text
and one picture each; the words below are spoken, not printed. Video is 3:00. Total 10:00 with a 30 s buffer.

| Time | Slide | Who | Say |
|---|---|---|---|
| 0:00 | **"Donna. You call her. She hires."** (office screenshot) | S | "This is Donna, a secretary you call on the phone. Her voice is Higgs Realtime. Her brain is a normal Claude Code session on my laptop. When you ask for work she doesn't do it, she hires, and the office shows every agent at a desk." |
| 0:30 | **The moment** (1.5-preview announcement, one line: "always listening") | S | "On Thursday 1.5 dropped and the model stopped waiting for its turn. It listens the whole time. That's the thing OpenAI's Live API did two weeks ago, and over there the point wasn't chat. It was delegation: the voice keeps talking while a bigger agent works." |
| 1:00 | **The gap** (two bars: "blocked 20 s" vs "claims done, 29%") | S | "A listening model that has to act has two bad options. A tool call blocks: silence. Or it fills the silence: on the first turn, 1.5 says 'I've handed that off' without calling anything about a third of the time. Higgs had no delegation; the docs say a tool call is one turn." |
| 1:40 | **The finding** (one log line: a call left open, output returned 25 s later) | S | "Except a call can stay open across turns and the output can come back later. Undocumented. That one behaviour is the whole project: Live-API-style delegation on Higgs, no server change needed." |
| 2:10 | **How it's wired** (diagram: phone → voice ↔ brain ↔ workers → office file → scene) | J | "Four parts. The voice: Higgs, through a thin layer shaped like the Live SDK. The brain: Claude Code, with one skill file as its job description. Workers: whatever Claude Code spawns, each in its own git worktree. The office: a viewer that draws one JSON file written by Claude Code's own hook events. No orchestration code of ours anywhere; we rely on how Claude Code dispatches agents." |
| 2:50 | **Demo video** | both | Play the 3:00 cut. J narrates over the muted parts if any. |
| 5:50 | **What was hard, 1 of 2** (table rows 1–5) | S | Three sentences each, number last: no delegation primitive → open calls, 24/24; the model lies → guard, 29% to 0 fabricated on goodbye; results land on the wrong task → task-line prefix, 16 to 0; barge-in kills the session → never cancel, rotate, 20/20; when to speak → hold policy. |
| 6:50 | **What was hard, 2 of 2** (table rows 6–8) | J | Orchestrator with no code → teammates discovery, one reducer rule; transfer without session.update → fresh session in the worker's voice, 5/5; prompts are measurement → 3,000-char cap, before/after tables. |
| 7:50 | **What we found for Boson** (16 issue titles, small) | S | "Sixteen issues filed to Boson this afternoon with reproducers. Three that matter: cancel at response.created wedges the session; outputs pair by recency, not call id; a tool named delegate is intercepted. And the one feedback issue: what would make client delegation first-class." |
| 8:30 | **What's Boson's, what's ours, what was before** (three columns) | J | "Boson: the voice, VAD, barge-in, STT, tool calling, every TTS voice. This weekend: the delegation layer, the phone, the brain protocol, hook-fed office state, transfer, Codex as a second brain, and the findings. Before: Mike, my earlier notch app and its /call skill, and my Chamber scene, adapted." |
| 9:00 | **Live beat (optional, replaces "Try it")** | S | Press Call Donna. "Hey, so I forgot the numbers for what was hard. Can you make HTML slides for these?" The demo repo holds `WHAT_WAS_HARD.md` with the numbers and transcript; the brain hires a worker who builds `slides.html` from it; Donna reports in ~60 s. Then: "Open it in my browser." Flip through two slides, say "thanks, bye". Fallback: the printed slides 7 and 8. |
| 9:20 | **Close** (the phone ringing) | S | "The part I like most isn't the voice. It's that she calls you back. You go code, the office works, the phone rings when it matters. Questions." |

## Q&A, likely questions
- **Why not wait for the tool?** The call is the product; waiting makes a voice assistant an IVR menu. Donna keeps talking, asks the one question that matters, and rings you back.
- **Isn't delegation just a bigger timeout?** No: the output returns in a later turn, as a real `function_call_output`, and the model speaks it in context. Timeouts can't do that.
- **Why Claude Code as the brain?** It already has agents, agent-to-agent messaging, resume and hooks. We wrote zero orchestration code; the skill is prose.
- **What breaks?** Higgs pairs outputs by recency and cancel at `response.created` wedges the session; both reported, both worked around. No echo cancellation, so speakers need the mute.
- **Latency?** Donna's first word ~1 s after you stop; the brain's take ~8 s; a two-worker page ~60 s; transfer ~10 s; ring-back ~15–30 s after the result lands.
- **Codex?** Same phone, same skill, `--brain-engine codex`; workers run as `codex exec` with live notes. Tested headless, one worker; not on a mic yet.
