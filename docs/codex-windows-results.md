# Codex on native Windows — October 24, 2026

Based on upstream `main` at `91f7941`, including the Codex implementation from PR #69
and the office review/reporting fixes. Claude remains the default engine. The Windows
launcher explicitly selects Codex, Sol, low-effort workers and a medium-effort brain.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Python self-checks | PASS | `herd.py`, `higgslive.py`, `bridge.py selftest`, `dash.py --selftest` |
| Offline Codex integration | PASS | Four fake-CLI tests: parallel workers, queued resume, failure, nonterminal brain acknowledgement |
| Producer/office timeline | PASS | 24 steps, including the new upstream fixture |
| Office | PASS | 56 tests; type-check, build and source-boundary check pass |
| Real Codex orchestration | PASS | Donna hired Maya and Theo in separate worktrees, reviewed real signup/pricing files and issued one combined result |
| Two working hires within 20 seconds | FAIL | Hires registered after 43.3 and 44.2 seconds; do not describe this as instant |
| Real worker conversation resume | PASS | A question routed through Donna resumed Maya's existing native thread; her answer returned in 37.4 seconds |
| Original project preserved | PASS | Original checkout stayed clean and its HEAD unchanged; deliverables remained in the task worktrees |
| Real Higgs lifecycle | PASS | Authorized primary-key run: question, typed answer, delegation, goodbye, later result rings a second call; both sockets closed |
| Higgs worker voice transfer | UNVERIFIED | This run used the lifecycle driver, not its separate transfer flow |
| Human microphone, barge-in and voice quality | UNVERIFIED | Automated voice run was headless; local demo is ready for a person to try |

Real Codex task: a dependency-free landing page with signup form and pricing table.
Request to combined reviewed report: **356.1 seconds**. The workers could not commit
through protected Git metadata; they reported that limitation, and the integration
worker copied the two pricing files unchanged. Nothing was pushed or published.
Browser rendering of that generated page was not verified by the workers.

The real Higgs run took **43.6 seconds** overall. Its four typed user turns reached
the first received audio event in **0.46–0.77 seconds**. These are text-to-audio
measurements, not microphone-to-speaker latency. The driver used a scripted brain;
its named workers used real Codex. The separate file-building run above used a real
Codex brain and real workers. There was no real Claude inference.

## Usage

- Higgs: eight response usage records, **15,371 input tokens** including **14,624
  cached**, and **104 output tokens**. At the mirrored rate card in `docs/pricing.md`,
  that token usage estimates to **US$0.00468425**. Actual account credit debit is
  **UNVERIFIED**; the response does not expose a balance/debit receipt. This used the
  explicitly authorized primary key, not key 2.
- Codex: the orchestration/resume run reported **2,508,789 input tokens** including
  **2,369,408 cached**, and **24,089 output tokens**. The voice driver's two real
  worker fixtures added **83,480 input** including **68,352 cached**, and **166 output**.
  Total reported: **2,592,269 input**, **2,437,760 cached**, **24,255 output**.
  Native-thread cumulative usage snapshots are counted once per thread, not summed
  again on every resume. Codex used ChatGPT sign-in; a dollar or credit debit was
  not returned and is **UNVERIFIED**.
- No Google Cloud or ElevenLabs calls were made for these tests.

Raw test evidence stays in ignored local runtime records; keys, logs, worktrees and
native session identifiers are excluded from source control. Future Codex CLI usage
snapshots are recorded beside each agent in `usage.jsonl`, outside the office feed.

## Try it

Run `start-windows.ps1` from PowerShell after setting the local Boson key and signing
in to Codex. The office is `http://127.0.0.1:3014/`; the interactive phone terminal
waits for Enter. Its default project is an isolated scratch Git repository.
