# Donna and the herd: the mailbox between the voice and the brain (design memo Oct 23, rewritten Oct 24 for the shipped code)

Windows host: `start-windows.ps1` keeps the same Codex worker/mail/office contracts without tmux.
`bridge.py --brain-engine codex` registers a `native_brain`; `wake()` resumes its CLI thread on
new phone tasks or worker results. The brain reads pending inbox tasks, hires/revises named herd
workers and writes its own note/ask/say replies. A completed CLI turn is not itself a completed
parent task: planning acknowledgements remain open, and worker results wake the review turn.
`meta.thread` and `meta.session` retain the actual brain ID; each worker retains its own thread.
Workers use an OS file lock (fcntl on Unix, msvcrt on Windows), UTF-8 and stdin prompts. This is
still the CLI implementation; app-server live steering remains an optional future upgrade.

The voice receives the attached project identity on every call, including when `context.txt`
is absent. Both the voice and `/call` interpret "here" as that repository and its task
worktrees, not sibling folders or the saved agent-app project catalogue. This is a project
selection/prompt contract; it does not turn the orchestrator's full-access CLI into an OS
filesystem jail. Models must not expand a lookup outside the attached project.

## Result delivery and restart

After review, register a file with `herd.py result donna <task-id> <file> --title "Page"`.
The helper accepts only the attached repository or one of its Git worktrees, snapshots the
file in local result storage and adds an Open result link to its report. Registration can
also attach a file to a completed task without changing its native session or creating
another completion. HTML must be standalone, with embedded styles and scripts.

`notifications.py` derives pending speech from the saved outbox and task/project state.
The phone recovers unspoken results after restart instead of starting at EOF. Acknowledgements
live in `herd/donna/notification-acks.json`; `task.spoken` is emitted only after a response
conveying the reviewed report has finished its playback window. A greeting alone is not a
delivery receipt. Recovery callbacks read the saved report rather than merely announcing
why Donna is calling. A connection failure, interrupted
speech or speaker failure leaves the result pending for the next restart. Delivery is
at-least-once across a crash at the acknowledgement boundary. Already resolved questions,
superseded requests and other projects do not ring; transfers remain live-call commands.
Identical reports for the same registered file can acknowledge their refinement task IDs
with one callback. Saying goodbye or using Hang up keeps the service armed; Ctrl+C stops it.

Reference: `warmblood-kr/remuda` and `warmblood-kr/remuda-butler` (verbs `new/ls/send/capture/close`; mail with a `Next:` reply
line; deferred replies; code-built status). We borrow the vocabulary and the invariants, not the Rust/Lua/Matrix.

## 1. The model

- **One frontliner: Donna.** She is the only one who talks to the user and the only one who calls the user.
- **The voice is her mouth, the brain is her mind.** The voice is the Higgs Realtime session run by `bridge.py`/`higgslive.py`.
  The brain is the user's own interactive Claude Code session on the `/call` skill. Anything substantive goes
  `delegate_task` → the brain's inbox (the call stays open); the brain answers with `herd.py reply`. Small talk and status
  ("how's it going?", answered from `office.json` by `higgslive.office_status`) come from the voice directly.
- **Workers are the brain's Agent-tool subagents** (named Sonnets, `run_in_background`, one git worktree per task). They
  never talk to the user and `herd.py` does not spawn them; Claude Code dispatches, the hooks report them to the office
  (`docs/office-state.md`).
- **Codex edition (#66, `bridge.py --brain-engine codex`):** the brain is interactive Codex in tmux `donna` (full access,
  no hooks; `herd.py new donna --kind codex` records `CODEX_THREAD_ID` as `meta.session`; the tmux typing is its only wake,
  for phone tasks and for worker results). Workers are herd agents of kind `codex`: `herd.py new Ava --kind codex --project
  <worktree>` + `herd.py send Ava "<brief>"` starts `herd.py run` in the background, which runs `codex exec --json -s
  workspace-write -C <worktree>` (medium effort), replies `take`, a `note` per `command_execution`/`file_change` item
  ("Running npm test", "Editing index.html"), `say` (its last message) or `fail` at exit, saves the thread id in
  `meta.json` `thread`, and types "Worker Ava finished task <id> (say|fail): …" into the brain's window. Another `send`
  resumes that thread (`codex exec resume`; one turn at a time per worker, `.run.lock`). `office()` draws them from their
  herd files (first brief line = role, last note = action). Upgrade if items ever run short: `codex app-server`.
- **The phone is proactive both ways.** A `say` with nobody on the line rings the user (`bridge.py --ring`); the voice
  opens with "Calling about: …".
- **One voice per call.** Donna's, unless the user is put through to a worker in that worker's voice (§6).

## 2. Architecture

```
user ⇄ speaker+mic ⇄ Higgs voice "Donna" ⇄ bridge.py ⇄ ~/.higgs/herd/donna/{inbox,outbox}.jsonl ⇄ the brain (Claude Code, /call)
                                                                                                   │ Agent tool: subagents in worktrees
        office ◀── ~/.higgs/office.json ◀── herd.py hook <Event> (hooks/office.json) ◀─────────────┘
```

## 3. The contract on disk (one directory per agent)

```
~/.higgs/herd/
  events.jsonl                   # append-only; every state change
  donna/                         # kind: session (the Claude Code session running /call)
    meta.json  inbox.jsonl  outbox.jsonl  status.json  context.txt
```
`inbox.jsonl`: `{id, task, context, from, ts}` plus `transcript`, `in_reply_to`, `replaces`, `with` (§6).
`outbox.jsonl`: `{id, kind: take|note|ask|say|fail|transfer, text, ts}`. `status.json`: `{state, task_id, task, last_note,
started, unread, tasks: {id: {state, task, asked?, ts}}}`; `state ∈ {starting, idle, working, needs_you, done, dead}`, Donna
additionally `speaking` and `on_call` (set by the bridge); a task's `state ∈ {queued, in_progress, needs_you, done, failed}` (§7):
readers take state from there, never infer it.

`events.jsonl` lines (`agent.new`, `task.sent|taken|note|needs_you|done|failed|transfer|spoken`, `agent.state`,
`call.ring|answered|ended|transfer`, `voice.speaking|user`, `agent.close`) are appended by `herd.py` and the bridge; the office
does not read them, it reads `office.json`.

## 4. The phone

`bridge.py --ring` runs with no call open. It watches Donna's outbox: a `say` while nobody is on the line opens a Higgs
session on the speaker seeded with `Calling about: <text>` (the voice speaks first), logs `call.ring` then `call.answered`;
Enter calls Donna instead. The call ends on "bye" (the voice's "Hanging up now."), after 60 s of silence or Higgs's 300 s
idle timeout. Results that land with nobody on the line ring again (one call at a time). A task still running at hang-up is
released by the bridge, so its later `say` rings. Twilio is spec only (`probe/r15/E-twilio.md`).

## 5. The hook reducer

`herd.py hook <Event>` (stdlib, ~40 ms; registered for six events by `hooks/office.json`:
`claude --settings ~/projects/higgs-hackathon/hooks/office.json`) reads the hook JSON on stdin, logs the event and re-renders
`office.json` (shape: `docs/office-state.md`). It acts as the brain only when there is no `agent_id` (a subagent's tool call
never consumes the inbox) and `session_id` equals `donna/meta.json` `session` (before one is recorded, `cwd` equals `project`).
Two wakes for a brain that went quiet:
- `PostToolUse` hands the brain new inbox lines mid-work (`hookSpecificOutput.additionalContext`: each task, its transcript and
  its `herd.py reply` lines; offset in `donna/.hook_offset`, separate from the wait loop's `.offset`);
- `Stop` blocks the brain's idle stop once (`{"decision":"block"}`, not again while `stop_hook_active`) while inbox lines sit
  past `.offset`, and `herd.send` to donna types `Phone task <id>: …` (or `Answer to task <id>: …`) into the brain's tmux
  session (`donna`, or `donna-<dir>` for another `HIGGS_HOME`; `bridge.py --brain REPO` starts it). With no take 20 s after a
  task the bridge logs it and the voice says the brain is not answering.

## 6. Inbox extras and transfer

Inbox lines from the voice carry `"transcript": [[role, text], ...]` (the call's last 12 turns, `user`/`assistant`) in place of
`context`, and `"replaces": "<id>"` when the user corrected an earlier task (the brain fails the old one with
"Replaced by the corrected request."; the voice has already dropped its result).

Oct 24 (#28), transfer: "get me on the line with Maya" is a delegation like any other; the brain answers `transfer "Maya"`.
The bridge has the voice say it is putting them through, ends that Higgs session, plays a hold cue and starts a fresh one
(never `session.update` mid-call) in Maya's voice (`office.json` `workers[].voice`) with `bridge.worker_prompt` (who she is,
what she worked on, the last 6 turns). Every question there is a delegation with `"with": "Maya"`; the brain forwards it to
the Maya subagent (SendMessage) and `say`s her answer. Her voice ends with "Putting Donna back on." (or 60 s of quiet does)
and a fresh Donna session opens with a two-line summary and "Hey, it's Donna again."; "bye" hangs up from either.

## 7. Task lifecycle and when Donna's voice speaks (Oct 24, after two real calls)

Vocabulary: **Donna's voice** is the Higgs Realtime session (hears, speaks, calls `delegate_task` / `task_status`); **Donna's
brain** is the Claude Code session running `/call` (does the work, keeps state, replies `take|note|ask|say|fail`); the
bridge is the phone line between them. To the user there is one Donna.

Two real mic calls showed the same three gaps: results were announced on the task's clock, not the conversation's (Donna's
voice asked the user a question, then six seconds later dropped it to say "Done, your page is open"); the voice could not
tell "queued behind another task" from "being worked on"; Donna's brain had no way to ask the user anything mid-task except
a `say`, which reads as a result. Reference: remuda-butler's per-session `.state` (`working / idle / needs you`) and its idle-notice
policy, the explicit list of conditions under which the butler may speak to the owner.

### The state machine (`herd.py`, per task, in `status.json` → `tasks[id]`)

```
send ──▶ queued ──take──▶ in_progress ──say──▶ done
                              │   ▲           └─fail─▶ failed
                             ask  │ send --reply-to ID (the user's answer)
                              ▼   │
                            needs_you
```
`herd.py reply NAME ID KIND TEXT`, `KIND ∈ take | note | ask | say | fail | transfer`:

| reply | from | to | event | agent state |
|---|---|---|---|---|
| `send` | – | `queued` | `task.sent` | unchanged |
| `take` | queued | `in_progress` | `task.taken` | `working` |
| `take` | in_progress, needs_you | no-op (no line, no event) | – | – |
| `note` | any | unchanged | `task.note` | – |
| `ask` | queued, in_progress, needs_you | `needs_you` (+ `asked`) | `task.needs_you` | `needs_you` |
| `send --reply-to ID` | needs_you | `in_progress` | `task.sent` with `in_reply_to` | `working` |
| `say` | queued, in_progress, needs_you | `done` | `task.done` | derived |
| `fail` | queued, in_progress, needs_you | `failed` | `task.failed` | derived |
| `transfer` | queued, in_progress, needs_you | `done` (text = the worker's name) | `task.transfer` | derived |
| any but `note` | done, failed | **refused** (nothing written) | – | – |

`take`, `ask`, `say` and `fail` on an unknown id are accepted (they create the record): `reply donna now say "…"` is how
Donna's brain places a call, and an unprompted `ask` rings the user with a question. The agent state is derived after every
reply: `needs_you` if any task needs the user, else `working` if any task is in progress, else `idle`. Queued tasks do not
make an agent busy; the inbox is the queue. The user's answer is not a new task: it is an inbox line with `in_reply_to` and
Donna's brain continues the original task and `say`s on the original id.

### Per transition: what Donna's voice does

| arrives at the voice (from the brain, over the bridge) | spoken? | how |
|---|---|---|
| `task.sent` (a second task while one runs) | no | one ack sentence for the user's request, as today; `task_status` says "waiting in Donna's queue" if asked |
| `take` | no | `task_status` says "working on … for N seconds"; never narrated |
| `note` | no | `task_status` adds "latest note: …" |
| `ask` | **now** | a user-role note with the question; the voice asks it in its own words, as its own; the user's next utterance is sent back to the brain verbatim with `herd.py send --reply-to ID` |
| `say` / `fail` | **when the conversation allows** | the open `delegate_task` call's `function_call_output` (or a plain note for a task sent to the brain from a shell), under the hold policy below |

### The hold policy (`higgslive.py` `_speak_loop`)

A result is **held** while any of these is true, and spoken once none is:
- (a) the voice's last utterance was an open question and the user has not spoken since. An open question is one that
  ends with "?", is at least five words, carries a decision (which, should, do you want, prefer, "blue or …", or), and is
  not a stock closer ("How can I help you today?", "anything else?", "let me know"); a question the brain sent as an `ask`
  is open whatever the voice's wording. A result held only for an unanswered question is released after 6 s of silence:
  the user is not going to answer it;
- (b) the user spoke (or typed) within the last 3 s;
- (c) less than 2.5 s of mutual quiet since the later of the voice finishing and the user finishing.
Any hold ends after 10 s at most. `ask` items skip the hold entirely (they only wait for the voice to be idle) and jump
ahead of any held result. While a result is held and the user **starts speaking**, the result is attached to that turn:
its `function_call_output` is sent at `speech_started`, before the server's own end-of-turn response (Higgs ignores
`create_response: false`, so the response cannot be delayed; sending at speech start is what gets the output in front of
the model for that very reply). The voice then answers the user and adds the result as an aside, which is what the two
MECHANICS lines ask for: a finished task is mentioned after answering what the user just said; a question from the brain is
asked plainly, as the voice's own, and the answer is passed back automatically, so the voice only acknowledges. A typed turn (`--text`, or a
stdin line in `--ring --silent`) attaches the same way: held output, then the user's item, then `response.create`.
Nothing narrates a state change nobody asked about: `take`, `queued`, `note` reach only `task_status`.

### Donna's brain (`/call` skill)

`take` before starting (sets `working`; an untaken task reads as queued), `note` at each real step, `ask` for a decision
(the answer comes back as an inbox line with `in_reply_to`), `say` or `fail` once, on the original id. The bridge no longer
serialises delegations to the brain: every `delegate_task` lands in the inbox at once and `status.json` says which one is
queued, in progress, or waiting for the user. The headless check for all of this is `tests/fake_donna.py --demo` (a scripted
brain against a real voice).
