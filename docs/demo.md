# Demo run sheet and submission draft (#12)

The spoken lines are those of `docs/demo-script.md` (the video, two presenters). Section 2 is what Donna actually said when
the script was rehearsed headlessly on Oct 24, 13:05-13:45: typed turns on `bridge.py --ring --silent`, the real brain
(Claude Code, Sonnet, `/call` from this checkout) in a fresh git repo with only a README, key 2, `uv run tests/rehearse_demo.py`.
Latency = from the end of the presenter's line to Donna's first audio. Not yet run on a live mic.

## 1. Setup (once, before going on)
1. EarPods in (Donna must not come out of the laptop speakers: no echo cancellation). `export BOSON_API_KEY=…` (one key per live call).
2. Office: `cd office && npm run dev`, open http://127.0.0.1:5183 (API on :3003).
3. Demo repo `~/projects/donna-demo`: a clean `main`, README only, and a GitHub remote (`git remote -v`; `gh auth status`).
   Without a remote the pull request beat rings back with "I couldn't open the pull request, the project has no GitHub remote".
4. Brain, terminal 1, in `~/projects/donna-demo`: `claude --settings ~/projects/higgs-hackathon/hooks/office.json --model sonnet`,
   answer the trust question for a new folder, type `/call`. It registers and says Donna is on duty (about 12 s in rehearsal).
5. Phone, terminal 2, in `~/projects/higgs-hackathon`: `uv run bridge.py --ring --backend session --voice nora --out EarPods`.
   Expect `ring: waiting`. No `--brain`: nothing types into the brain's terminal; its background wait loop picks up each task.
   Optional instead of step 4: add `--brain ~/projects/donna-demo --brain-model sonnet` to step 5 (the brain runs in tmux);
   watch it with `tmux attach -t =donna`. The `=` matters: plain `-t donna` attaches to any session whose name starts with
   "donna" (a rehearsal brain got keystrokes that way on Oct 24).
6. Checks before stage: `curl -s http://127.0.0.1:3003/agency-api/health` answers; `tail -1 bridge.log` shows `ring: waiting`;
   the office shows Donna alone, call "off"; `uv run bridge.py selftest` prints `ok`.

## 2. The script, as rehearsed
Presenter lines in quotes, exact. "Runs" = run 2 and run 3 below (run 1 was before the fixes in this PR).

| # | Presenter says | Donna says / does (verbatim from the runs) | Office shows | Latency | If it misbehaves |
|---|---|---|---|---|---|
| 1 | Press Enter. | "Hey, it's Donna. What do you need?" (2/2) | Call: speaking, then listening. | 1.2-1.5 s | Silence after 5 s: say "Hi Donna". Nothing in 10 s: Ctrl-C, rerun setup 5. |
| 2 | "Let's build a small focus timer web app." | "On it." / "The office is on it." then, about 15 s later, ONE question with the brain's proposal: "Should I make it a one-page focus timer with twenty-five minutes of work and five-minute breaks, and include both light and dark modes?" (2/2) | Donna: "Got it: Build a small focus timer web app", then reading the repo. | ack 0.8-0.9 s; question +14-15 s | She starts building without a question: narrate "she judged it clear" and go on at beat 3 with "Give it a session counter." |
| 3 | "Yes, and give it a session counter." | Restates the plan, "The office is on it." The hiring note is silent until #73 lands (it is "Hiring Leo for the timer page and Mia for the styling", +9 to +12 s). Names: Leo and Mia in both runs, not guaranteed. | +12 s Leo and Mia "Being briefed" in Donna's room; +23 s "Hired: Builds the timer page and logic" / "Hired: Writes the timer stylesheet"; +35 s actions ("Running a command", "Writing style.css"). | 0.5-0.6 s | No rows in 40 s: look at the brain terminal. The brain asks a second question: answer "Yes, go." |
| 4 | "How's it going?" | From `task_status`: "Leo is building the timer page and logic, and Mia is handling the stylesheet." (2/2) | Same rows, actions changing. | 1.0-1.2 s | No names: "Who's working on it?" |
| 4b | "Actually, sorry, one thing: make the break five minutes." (typed in rehearsal, so no barge-in was tested) | Run 2: "Got it. I'll update that to a five-minute break." "Sent off." The voice sent it with `replaces` (a correction), so the brain closed the first task and gave the result on the new one; the brain passed it to Leo ("Passed the five-minute break to Leo"). Run 3: "Got it, five-minute breaks. I'm updating that now." and NOT sent (the proposal already said five-minute breaks); fixed after the run (that claim now forces the call), unverified. | Run 2: Donna "Got it: Make the break five minutes", a third assignment row. | 0.5-0.6 s | Not sent (no "Got it:" row): say it again as "Tell Leo to make the break five minutes." Five is already the default, so ten makes the change visible. |
| 5 | (wait) | Result 30-60 s after beat 3: "Leo built the focus timer with twenty-five minute sessions, five-minute breaks, and a session counter, and Mia handled the light and dark styling. The code is on its own branch and passes syntax checks, want me to open a pull request?" (run 3; run 2, before the names fix: "The timer's ready with …", no names) | Mia done, then Leo done; Donna "Reviewing", then "Reporting". | spoken 2-3 s after the brain's `say` | No result in 2 min: "How's it going?" |
| 6a | "Who built the timer?" | "Leo built the timer page and logic." | | 0.6 s | |
| 6b | "Put me through to Leo." | "The office is on it." then +10 s "One sec, I'll put you through to Leo now." hold cue, then in jake's voice: "Hey, it's Leo." | Leo walks to the phone; "On the line: Leo". | ack 0.9 s; Leo +12 s | Stuck: "Put Donna back on." |
| 6c | "Why did you pick that interval length?" | Leo answered once from his head first ("…long enough to get into a flow state…"), then the real answer from his own session +20 s: "I didn't actually choose it; the brief specified twenty-five minutes, so I used those. It's the standard Pomodoro length." | | 0.6 s; real answer +21 s | Cut between the two answers, or ask "What did you build?" |
| 6d | "Put Donna back on." | "Putting Donna back on." then "Hey, it's Donna again." | Leo back to the lounge, Donna on the phone. | 0.5 s; Donna +2.6 s | |
| 7 | "Open a pull request. Thanks, that's all, bye." | Sends the pull request to the brain, then the call closed. In run 3 it closed on the tool call's response before any goodbye was spoken; fixed after the run (the call closes on the goodbye's response), unverified. Expected: "… Hanging up now." | "Got it: Open a pull request." | | No hang-up in 10 s: say "bye" again. |
| 7b | (wait; the phone rings, press Enter) | Run 3, no remote: rang +14 s after the hang-up: "I'm calling because I couldn't open the pull request, the project has no GitHub remote to push to. …" With the demo repo's remote the brain pushes and opens it itself (no extra question: "open a pull request" is the yes). "Thanks, bye." → "… Hanging up now." | Call: ringing, speaking. | ring +14 s | No ring in 60 s: Enter to call her, "Is the pull request up?" |

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
- No mic or audio: the same lines typed, `uv run tests/rehearse_demo.py OUTDIR` does the whole script against a fresh repo
  and the real brain (export the key first); narrate over the office.
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
