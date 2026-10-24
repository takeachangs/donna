# Chamber demo checklist (Sat ~3pm, Toronto)

Smoke test and run sheet. Facts come from README, ARCHITECTURE and PRs #5, #6, #7, #9, plus issue #8. "(after #8)" marks the intended final state. #8 was in progress when this was written, so re-check it on the demo build.
Data dir below: `D=$(mktemp -d)`; logs are in `$D/calls.jsonl`, `$D/executions.jsonl`, `$D/workspace.json`.

## 1. Before the demo (10 min)
- [ ] `.env` has `BOSON_API_KEY` (copy `.env.example`). Only one Higgs voice session at a time, so close other dev servers (ports 3003, 5183).
- [ ] Claude Code signed in: `claude auth status` (costs no inference). `ANTHROPIC_API_KEY` is stripped for workers by the server, so there is nothing to unset.
- [ ] Codex: `codex login status`. Not signed in is fine: the server falls back to Claude Code.
- [ ] Engine choice: `export AGENCY_DEFAULT_PROVIDER=claude` (safest, verified live on 2026-10-24), or leave unset for the auto-fallback. Optional: `AGENCY_BRAIN_MODEL` (default `opus`), `AGENCY_VAD_SILENCE_MS` (default 800).
- [ ] Fresh data: `export AGENCY_DATA_DIR=$(mktemp -d)` (never the live office data).
- [ ] `npm ci && npm run dev`; open http://127.0.0.1:5183/
- [ ] Server log shows one line like `[engine] default worker engine: claude (...)`. It must name the engine you intend.
- [ ] Footer engine status: default engine verified and enabled. Office shows Donna alone, no "Project 01" (after #8; before #8 an empty "Project 01" exists).
- [ ] Browser: Chrome, click once on the page first (autoplay policy can mute the ring chime), allow the microphone when prompted.
- [ ] Output device set (system output or AirPods). Laptop mic in, since an AirPods mic degrades STT.
- [ ] Pre-flight voice test: click **Talk to secretary**, **Enable microphone**, say "Hello". Pass: a plain greeting, no talk of work. Then **Stop speaking**.

## 2. Headless checks (typed text, no mic)
Connect, then type into the goal box. Each check uses the same server and data dir.

- [ ] **Office loads.** Open the URL with DevTools open. Pass: no console errors; the office floor renders; no 4xx on `/agency-api/*`.
- [ ] **Request acts in the same turn.** Type `make me a landing page for a bakery`. Look: `calls.jsonl` rows for this turn. Pass: `create_project` (with `initial_work` set; or `initial_work:null` followed by `delegate_work` in the same turn), and a final one-sentence reply saying what was confirmed. No "shall I", no "I can't". Was 6/6 on PR 7's harness; a claim with no call was about 1 in 6 on earlier prompts, so retry once if it happens.
- [ ] **Status is truthful.** While a worker runs, type `how's it going`. Look: `workspace.json` assignment statuses. Pass: the reply matches the state (plan running means planning; worker running means a worker is on it). Loose wording such as "the plan is in progress" is a known blemish, a wrong phase is a fail.
- [ ] **Greeting.** Type `hello` with work running. Pass: a greeting and nothing else (5/6 in PR 7; "the bakery page is being built" counted as a miss).
- [ ] **Brain plans two workers.** Type `build a landing page with a contact form`. Look: `workspace.json` assignments of `kind` plan, crew, review. Pass: plan, 2 crew (the second `depends_on` the first), review; the same brain `threadId` in the plan and review rows of `executions.jsonl`; exactly one briefing with both workers as contributors and all files (`index.html`, `styles.css`, `script.js`). Expect about 85 s end to end (plan about 24 s, workers about 21 s each, review about 17 s).
- [ ] **Announcement.** Connected when the briefing lands. Look for the server log `[ring] holding ...` then `[ring] announcing "<title>" for <project> after N s`. Pass: Donna says "The review for X is ready; want it now?" and the report stays `queued`.
- [ ] **Restart mid-task.** While a worker is `working`: stop the server, rerun `npm run dev` with the same `AGENCY_DATA_DIR`. Pass: `workspace.json` and the UI keep the project, assignments and queue; nothing is staffed twice. Resume the interrupted step if it shows paused or failed. (Recovery is designed; this exact case was not in any PR check, so run it before the demo.)
- [ ] **Second request while one runs.** Repeat the same goal within 2 minutes. Pass (after #8): one assignment only; the existing one is returned with `note: "already queued"` and Donna says it's in progress. Before #8 this duplicates; do not demo it.

## 3. Mic checks (presenter)
- [ ] **Connect.** Talk to secretary, enable microphone. Pass: a status line and Donna replies to "Hello".
- [ ] **10-second request with pauses (VAD 800 ms).** Say, with a 1 s pause in the middle: "I want a landing page for a bakery, um, with a menu section, and a contact form." Pass: Donna waits for the end and does not talk over you. If she cuts in, raise `AGENCY_VAD_SILENCE_MS=1000` and restart. Not measured with a real mic in Chamber.
- [ ] **Interrupt.** While Donna speaks a long answer, say "stop, wait". Pass: she stops; a report being read stays queued.
- [ ] **Announcement when connected.** Stay connected while the brain finishes. Pass: "The review for X is ready; want it now?" at a pause, not over you. Say "yes". Pass: she reads that report.
- [ ] **Ring when disconnected.** Disconnect, wait for the briefing. Pass: two-tone chime, **Calling** badge, the connect button reads **Answer Donna**, status "Donna is calling about ...", Donna walks to the entrance phone. Click **Answer Donna**: it connects and that report is read first, then Donna walks back.
- [ ] **Idle 5 min.** Not documented or verified anywhere. Try it once before the demo (leave the call open 5 min, then speak) and write down what happens. Do not rely on a long idle on stage.

## 4. Known limits and do not do on stage
- Not verified: the reduced-motion path; whether the ring chime is audible (autoplay); the card badge look when connected; Donna and desk animations (thinking, working, crew desks appearing) in a real browser; the engine badge in the UI; pause/interrupt of a real running `claude` process; Donna choosing `provider:"claude"` on a paid turn; Codex under the brain; 800 ms VAD feel on Chamber's own mic path.
- A revision after the review does not re-run the review by itself. Resume it or delegate again. Do not revise on stage.
- Use `higgs-realtime`. 1.5-preview skipped the tool call in 29% of first turns and allows about 2 concurrent generations per key.
- One voice session at a time, so no second browser tab connected.
- Engine: Codex is the default when signed in (GPT-6.1 Sol / low) and was never exercised with the brain; Claude Code is verified. Claude workers have file tools only (no shell). Pin `AGENCY_DEFAULT_PROVIDER=claude`.
- Before #8: an empty "Project 01" exists, and Donna may create a duplicate "Project 01" and mistype an id. Do not demo the first request in a room-less state until #8 is merged; if not merged, ask for work from inside the selected project.
- "Claim without a call" (about 1 in 6): if Donna says "I'll assign a worker" and nothing appears in the scene, repeat the request.
- Workers return text and files only. No deploy, mail, calendar, outbound phone calls or per-worker voices.
- Keep Higgs spend in mind (about a few cents per run); Claude cost figures are list-price estimates.

## 5. The 3-minute script
Pre-start: connected, mic on, Donna alone in the office (after #8). Keep the typed box and a pre-recorded clip of a full run ready.

| Time | Presenter says | Donna says | Scene shows | Fallback |
|---|---|---|---|---|
| 0:00 | "This is Chamber, your AI office. Hello Donna." | A greeting, no work talk | Empty floor, Donna at the suite | Type `hello` |
| 0:20 | "Make me a landing page for a bakery with a contact form." | One short sentence confirming the project and the work are set up | Room appears; Donna "thinking" (plan) | Type the same text |
| 0:45 | "How's it going?" | A status matching the state (planning, or a worker writing the page) | Crew desks appear, workers typing | Type it; or read the activity log aloud |
| 1:15 | (talk over the build) "Workers never talk to me; Donna's brain plans, runs, and reviews them." | Silent | Workers at desks; Donna "working" during review | Play the clip from here |
| 1:45 | Disconnect (click Connect/hangup) before the result lands to show the ring, if timing fits | - | Chime, **Calling** badge, Donna walks to the phone | Skip; stay connected and use the next row |
| 2:00 | Click **Answer Donna** (or say "yes" when she asks "want it now?") | "The review for X is ready; want it now?" then the briefing, naming the files and both workers | Delivery trip, report highlighted in the briefing queue | Click **Read report** and show Details/files |
| 2:40 | "Open the page." Open the file from the project room | - | Real `index.html` deliverable | Open the saved file from the data dir |
| 2:55 | "Everything stays local; the voice talks, the brain plans, workers act." | - | Office floor | - |

If a step stalls more than 20 s, switch to the fallback column and keep talking; play the clip if the brain takes over 90 s.

## Headless results, Oct 24 03:56–03:59 (main 6244b3b + #10 pending at the time), Codex 0.164 signed in, engine default `codex`
- [x] Office loads, no console errors.
- [x] "make me a landing page for a bakery" → `create_project` in the same turn; room "Bakery Landing Page"; brain (Claude) planned 2 Codex workers + a Claude review.
- [x] "how's it going?" → "The plan is being prepared now; the worker is queued and will start reviewing the project files shortly." (from state)
- [x] "hello" while work ran → "Hello! How can I assist you today?"
- [x] Workers Ellis and Miles finished (`review`), one briefing with both contributors, `[ring] announcing … after 0.2 s`, Donna: "The review for Bakery Landing Page is ready; want it now?"
- [x] "yes" → `read_briefing` → spoken summary naming both workers; briefing `presented`; `index.html`, `styles.css`, `script.js` in the workspace.
- [ ] Restart server mid-task (not run). [ ] Second request while one runs (covered by unit tests in #10 only).
Elapsed from request to announcement: ~2.5 min on Codex (the #9 live runs on Claude took ~85 s).
