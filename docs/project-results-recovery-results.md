# Project scope, results and restart acceptance — October 24, 2026

All live execution used isolated scratch repositories and runtime directories. Existing
projects, deliverables and native session IDs were preserved. No real Claude inference ran.

| Check | Result | Measured evidence |
| --- | --- | --- |
| Current-project question | PASS | Real Codex answered "What other projects do we have here?" using only attached metadata, task records and Git worktrees; 16.06 s. No sibling project was listed or scanned in the command trace. |
| Real execution and review | PASS | A named Codex worker fixed a seeded standalone counter; Donna independently checked it and registered the reviewed file; 93.72 s. Original checkout remained clean. |
| Open result | PASS | Clicked the report link in the actual browser. Three clicks changed the generated counter from 0 to 3. The previously missing dashboard was also registered and its search worked in the preview. |
| Crash before delivery | PASS | Killed the phone process before acknowledgement; both saved results remained pending. |
| Restart recovery | PASS | Real Higgs callback read both completed reports, including Open result. First audio arrived 1.59 s after process start; complete audio/transcript generation and headless acknowledgement took 5.047 s. |
| Restart after acknowledgement | PASS | No second connection or repeated callback during the bounded observation; deterministic tests also cover this state. |
| Interrupted/failed audio | PASS | Offline checks leave notifications pending and prevent acknowledgement after interruption or output failure. |
| Resolved/superseded requests and project changes | PASS | Offline checks exclude stale questions, replaced requests and another project's notifications. |
| Result storage and HTTP boundary | PASS | Outside-project files, unknown tasks, unregistered files, traversal, mutation and remote origins rejected; reviewed snapshots survive edits to the source. |
| Regression suite | PASS | 12 project/delivery checks, 4 fake-CLI Codex checks, four Python self-checks, 24-step and 46-step office timelines; 60 office tests plus type-check/build/source-boundary check. |

The voice check was **headless real Higgs**, with typed sign-off, not a live microphone or
physical speaker latency measurement. The final generated report contained 29.2 seconds of
audio. In a normal audible call, acknowledgement waits for the playback window; offline
checks exercise that wait and interruption guard. Delivery is at-least-once across a crash
at the acknowledgement boundary, not an exactly-once human-listening guarantee.

Two earlier voice checks exposed and corrected a false receipt: saying only why Donna was
calling, or acknowledging a report as a new request, must not mark the result delivered.
The final check conveyed the actual saved outcomes. These failed probes are included in
the usage below rather than omitted from the total.

## Usage for this acceptance run

- Higgs: five returned response records across failed and successful probes; 10,753 input
  tokens, including 7,184 cached, and 149 output tokens. Token-rate estimate using the local
  mirrored rate card: **US$0.00514325**. Actual account credit debit is **UNVERIFIED**; aborted
  connections returned no usage receipt, so that estimate cannot establish their debit.
- Codex: deduplicated native-thread cumulative usage: **666,693 input tokens**, including
  **611,072 cached**, and **4,558 output tokens**. ChatGPT sign-in was used; no dollar/credit
  debit was returned, so its monetary cost is **UNVERIFIED**.
- No Google Cloud, ElevenLabs or real Claude calls were made.

## Practical boundaries

Project selection is an explicit context and orchestration contract, verified against the
reported regression. It is not an OS filesystem jail: the orchestrator retains the upstream
full-access CLI permissions needed to manage worker worktrees. Result publication has its
own enforced path boundary, and preview HTML is isolated from the office origin.

Open result serves a reviewed local file snapshot. It does not deploy a site or launch a
backend. HTML previews require embedded scripts/styles/assets; their resource and API
requests are restricted. Old reports without registered files remain readable. The existing
missing dashboard was attached locally without rewriting it or changing its native session.

Raw traces, generated files, audio and native identifiers remain in ignored runtime storage.
