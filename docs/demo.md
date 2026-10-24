# Demo run sheet and submission draft (#12)

DRAFT for the user to edit. Nothing here was run live. Times are targets, not measurements.

## 1. Setup (once, before going on)
1. EarPods in (Donna's audio must not come out of the laptop speakers: no echo cancellation, see INDEX Gotchas). Keys exported (`BOSON_API_KEY`; one key per live call).
2. Office: `cd office && npm run dev`, open http://127.0.0.1:5183 (API on :3003).
3. Phone + brain: `uv run bridge.py --ring --backend session --voice nora --out EarPods --brain <repo>` (the `--brain` flag starts Claude Code on `/call` in tmux session `donna`).
4. Second screen: `tmux attach -t donna` (the brain at work; type here to wake it).
5. Checks before stage: `curl -s http://127.0.0.1:3003/agency-api/health` answers; `tail -2 bridge.log` shows `ring: waiting`; the office shows Donna at her desk, call "off"; `uv run bridge.py selftest` prints `ok`; `<repo>` is a git repo with a clean main (workers use worktrees).

## 2. The 4-minute script
Presenter lines in quotes. The phone rings on a `say`; start it with Enter in the bridge terminal (or `uv run herd.py send donna ...` from a shell).

| Time | Presenter says | Donna / expected | Office shows | If it misbehaves |
|---|---|---|---|---|
| 0:00 | Press Enter. "Hi Donna." | Picks up, greets in one short line. | Call state: listening, then speaking. | No sound: check `--out` device (bridge refuses unknown devices and exits 2); restart the bridge. Silence after pickup: say "hello" again; if nothing in 10 s, Ctrl-C and rerun step 3 (Ctrl-C quits the phone, not the call only). |
| 0:20 | "Make me a quiz game for my kids." (thin request) | Delegates, says one short line, then asks ONE question carrying a proposal ("Should it be a ten-question page, in plain HTML?"). | Donna working; an open decision. | No question, just starts: fine, narrate "she judged it clear". No take within 20 s: the voice says the brain is quiet; type `ok` in the tmux window to wake it (the brain's wait loop may be dead). |
| 0:50 | "Yes, do that." | Short ack. Workers spawn. | Named workers walk to desks and show "working" with their current action (hook-fed, within about 20 s). | No rows after 30 s: `cat ~/.higgs/office.json` for `workers`; hooks missing means the brain was started without `hooks/office.json`, restart `--brain`. Keep talking: "While that runs, what's on my plate?" shows she chats while work continues. |
| 1:30 | (Interrupt her once mid-sentence: "Actually, sorry, one thing...") | Stops talking at once, listens. | State flips speaking to listening. | On laptop speakers barge-in is disabled by design; stay on EarPods. |
| 1:45 | Wait for the result. | Speaks the result in 2-3 sentences ("The quiz is on its own branch and the tests pass. Want a pull request?"). | Worker walks the report to Donna; state speaking. | No result in 60 s: say "How's it going?" (one status line). Still nothing: headless fallback (section 5). |
| 2:15 | "Who built it?" | Names the worker ("Maya did.") | Highlights nothing new. | Wrong or no name: "Ask the brain who wrote the quiz page" (delegates). |
| 2:30 | "Put me through to Maya." | Hold cue (two soft rising tones), then "Hey, it's Maya." in a different voice. | Maya walks to Donna's phone; "On the line: Maya". | Stuck on hold over 10 s: say "put Donna back"; if no voice, Ctrl-C and re-ring. |
| 2:50 | Ask Maya: "What did you cover in the quiz?" | Maya answers in first person from her own context. | Same. | Generic answer: say it is her summary, move on. |
| 3:10 | "Put Donna back on." | "Hey, it's Donna again." | Phone call back with Donna. | As above. |
| 3:20 | "Thanks, that's all. Bye." (say "bye", not Ctrl-C) | One-line goodbye ending "Hanging up now." The call closes. Do not say "bye" before this; it ends the call. | State goes to off. | No hang-up in 10 s: Ctrl-C quits the whole phone; rerun step 3 for the next beat. |
| 3:35 | In a shell: `uv run herd.py send donna "check the quiz page once more"` or let a pending task finish. Look at the screen. | A `say` lands while off the line: the phone RINGS (state "ringing"); press Enter to take it; Donna opens with the result. | Call state: ringing. | No ring: `tail bridge.log`; the `--ring` process may have died; rerun step 3 and use Enter to call. |

Total spoken demo: about 3:50. If time is short, drop the interruption (1:30) and the Maya follow-up question (2:50).

## 3. What to say to judges (60 seconds)
- **The gap.** OpenAI's Live API has client delegation: the voice keeps talking while an agent on your machine works, and the result is spoken when it lands. Higgs Realtime has no equivalent. We built it: `higgslive.py` is the layer, same shape as the Live SDK.
- **What is Boson's.** Higgs Realtime (1.0 by default, 1.5-preview supported) is the whole voice: turn-taking, interruption, STT, tool calls. The TTS voices (Donna is nora; Maya and the others are chloe, eleanor, jake, marcus, oliver) are Boson's. We run no other speech model.
- **What is ours.** The voice talks; Claude Code on the user's machine does the work and dispatches its own subagents with the Agent tool; the office (Three.js, read-only) draws it from Claude Code hook events; the phone rings when a result lands while you are away; "put me through to Maya" opens a fresh Higgs session in her voice.
- **What we found** (all in `docs/INDEX.md` Gotchas and `docs/realtime-1.5.md`):
  1. Tool calls are asynchronous: a function call can stay open across turns and its output arrive later. Undocumented; our layer rides on it (6/6 on 1.5).
  2. Some function names are claimed by the server; ours is `delegate_task`. (Wording: see contradictions below.)
  3. `response.cancel` sent right at `response.created` drops the response with no `response.done`, which wedges naive retry logic; and a bare `response.create` after an assistant reply fails with 400 "No user input".
  4. 1.5-preview: only about two simultaneous generations per key, it claims a handoff without calling the tool 7/24 on the first turn, and `delegate_task.replaces` corrections do not work on it (0/4 vs 13/14 on 1.0). No echo cancellation: the mic hears the voice at 3x the user's level.
- **What was built when.** Prior work, disclosed: Mike (notch app, bridge skeleton, `/call` skill) and Jerrold's Chamber 3D scene (`office/`, adapted). Built at the hackathon (Oct 23-24): the Higgs delegation layer, the herd and brain protocol, hook-fed office state, ring/phone, transfer, echo and repeat guards.

## 4. Submission fields (DRAFT)
- **Name:** Donna
- **Track:** 3 Agents That Act (primary); 2 Conversation as the Interface (secondary)
- **One sentence:** Donna is a voice secretary on Higgs Realtime: you talk, a Claude Code session on your machine does the work with its own subagents, you watch them in a 3D office, and she calls you back when it is done.
- **Write-up (≤200 words; DRAFT, about 150 words):** Voice assistants either block while they work or fake it. Donna keeps talking. You tell her what you want over Higgs Realtime; if the request is thin she asks one question with a proposal, otherwise she hands it to Claude Code running on your machine, which works in git worktrees and dispatches subagents. You can keep chatting, interrupt her, or hang up: when a result lands she rings you and speaks it. Say "put me through to Maya" and a fresh Higgs session opens in Maya's voice, answering from her own work context; "put Donna back" returns. A read-only 3D office, fed by Claude Code hook events, shows who is working on what. It is for developers who want to direct coding agents hands-free. Built on a client-delegation layer we wrote for Higgs Realtime (`higgslive.py`), modelled on the OpenAI Live SDK.
- **How we built it (≤200 words; DRAFT):** Higgs Realtime (`higgs-realtime`, 1.5-preview supported) is the voice end to end: server VAD turn-taking, barge-in, `higgs-stt-3.1` input transcription, function calling, and the TTS voices (nora for Donna, others for workers). The hard part: Higgs has no client delegation, so `higgslive.py` keeps `delegate_task` calls open across turns and returns the agent's answer as the real `function_call_output` (async tool calls), appends silent progress notes, and guards against the model inventing results, repeating itself and mishearing its own echo. Corrections replace tasks. Transfer opens a new session per voice. Probed and documented: the 1.0 vs 1.5 differences in `docs/realtime-1.5.md`. Also: `audio/pcmu` works natively, so a phone line needs no transcoding (spec only, not built).
- **Repo:** https://github.com/takeachangs/donna (must be PUBLIC), pinned to commit `<SHA>` (fill after final merge). No keys committed (`.env` ignored).
- **Demo video:** `<URL>` (2-3 min, public). Cut from section 2: pickup to result to Maya to ring. Show `bridge.log` Higgs lines or the Higgs usage in the terminal once.
- **Team:** Seongmin Chang (takeachangs): voice layer, bridge, brain protocol, herd, docs. Jerrold (JerroldH): 3D office scene (Chamber). (Confirm names and handles.)
- **Known limitations (honest notes):** no live mic verification of every path at the time of writing; Maya's follow-ups depend on the brain forwarding to her subagent; MacBook speakers disable barge-in; 1.5-preview skips the tool call sometimes; no phone (Twilio) line; works on macOS with tmux, Claude Code and EarPods only.
- **Attach / link:** repo, video, optional screenshot of the office.

### Judging weights check
| Criterion | Weight | What earns it in the demo |
|---|---|---|
| Use of Higgs Audio | 30% | Async tool calls, barge-in, server VAD turn-taking, per-worker voices on transfer, STT, 1.0 and 1.5 findings. Would not work with a generic TTS. |
| User Experience | 25% | Talks while work runs, one question with a proposal, rings back with the result, "bye" hangs up. |
| Innovation | 25% | Client delegation for Higgs; the agent dispatches its own agents; voice transfer to a worker. |
| Technical Execution | 20% | `selftest`/`higgslive.py` checks, headless fake-brain tests, clear setup (section 1), honest limitations. |

## 5. Fallbacks when the live call fails
- No mic or audio: `uv run bridge.py --backend session --silent --text "make me a quiz game | yes, do that | who built it | bye"` against the real brain; narrate over the office.
- No brain: `--backend fake --silent --text "a | b"` for the layer alone.
- Everything down: play the recorded demo video (record one during rehearsal).

## Docs that contradict each other (listed, not fixed)
1. Issue #12 asks for a 3-minute `docs/demo.md` plus a separate `docs/submission.md`; the task here asks for a 4-minute sheet with the submission text inside `docs/demo.md`. The form wants a 2-3 min video.
2. Issue #12 says branch `issue-12`; the task uses `demo-12`.
4. IDEAS.md Oct 23 22:30 and `docs/herd.md` describe workers as headless `claude -p` via `herd.py` and Jerrold's scene reading `events.jsonl`; the Oct 24 ~07:00-08:00 entries replace that with the Agent tool plus `office.json` hooks. `docs/herd.md` may be stale.
5. CLAUDE.md and the `/call` skill step 4 say `--out AirPods`; the setup requested here uses `EarPods`. The bridge refuses an unmatched device name.
6. IDEAS.md Oct 23: Stage 2 Twilio is a stretch/spec only (`probe/r15/E-twilio.md`), while issue #12 lists "pcmu" in the Higgs usage statement; no phone line is built, so the draft says spec only.
7. IDEAS.md Oct 24 08:40 says the old `bridge.py say|note` CLI is gone, but CLAUDE.md "Facts" and older IDEAS entries still describe `~/.higgs/inbox.jsonl` and `bridge.py say|note`.
8. The `--silent --text` fallback is untested here; whether `--text` works with `--backend session` plus a live brain was not checked.
