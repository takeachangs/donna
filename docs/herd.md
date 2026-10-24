# Donna and the herd: a voice secretary who runs your coding agents (design memo, Oct 23 ~23:00)

Reference: `warmblood-kr/remuda` (a herd of agent sessions that outlives any ride; verbs `new/ls/send/capture/close`;
MCP and Lua on top) and `warmblood-kr/remuda-butler` (the butler: one coordinator that distributes work, mail with a
`Next:` reply line, cascading spawn, code-built status). We borrow the vocabulary and the invariants, not the Rust/Lua/
Matrix. Decisions below are from Oct 23 ~23:00 and replace the earlier multi-voice draft.

## 1. The model (decided)

- **One frontliner: Donna.** She is the only one who talks to the user and the only one who calls the user. She is the
  butler in the CTO's vocabulary: she takes the request, distributes the work, reports back.
- **Donna is a Claude Code session.** Plain Claude Code, no channels or other add-ons; the `/call` skill is her job
  description. She talks to the user through Higgs (the voice), not through any Claude Code feature.
- **One level deep.** Donna spawns worker Claude Code sessions (headless `claude -p`) for the actual work and never does
  long work herself. Workers never talk to the user; they report to Donna.
- **The phone is proactive both ways.** Donna can call the user (the voice starts speaking first: "Calling about…"),
  and while on the line the user can ask her anything, give new work, redirect.
- **MacBook first, Twilio second.** The first "phone" is the laptop speaker and mic: a helper that rings when Donna has
  something, hangs up when the conversation is over. The Twilio design (`probe/r15/E-twilio.md`) swaps the audio
  device for a phone line later; nothing above it changes.
- **One voice.** Donna's. (The six Higgs presets and the per-leader voices from the earlier draft are dropped; a
  `transfer` tool is not needed.)

## 2. What we take from remuda / butler

| Their idea | Ours |
|---|---|
| The herd outlives the ride | Workers live in `~/.higgs/herd/<name>/` and keep running when the call ends; a call (speaker now, phone later) is a *ride* that attaches to Donna. |
| Butler = one coordinator, cascading spawn | Donna spawns workers with `herd.py new` + `send`; depth 1. The scene shows Donna with her workers around her. |
| Verbs `new / ls / send / capture / close` | `herd.py`'s whole surface. Donna uses them from her shell; the bridge and the 3D scene read what they write. |
| Mail with a `Next:` line | Already ours: each inbox line tells the agent how to reply (`bridge.py say\|note <id>`). Workers reply the same way, into Donna's view. |
| Deferred reply (`pending{timeout, on_cancel}`) | The open `delegate_task` call in `higgslive.py`. Adopt the cancel reasons: a hang-up is `client_disconnected`; the result is held and Donna calls back. |
| Code-built status, never screen text | "How's it going?" is answered from `status.json` of every worker, not by interrupting them. Same source drives the scene's entity states. |
| Caller identity is advisory | Say so in our docs too: the PIN decides who talks (Twilio later); the sessions' own permission mode decides what they may do. |

Left out: PTY attach, Lua, Matrix, cluster, approvals/grants (later), real remuda as a backend (a backend swap later,
since the verbs and directory contract are the same).

## 3. Architecture

```
user ⇄ speaker+mic (later: Twilio) ⇄ Higgs voice "Donna" ⇄ bridge.py ⇄ Donna's Claude Code session (/call, inbox/outbox)
                                          │                                   │ herd.py new / send / capture / close
                                          │                                   ▼
                                          │                          worker sessions: claude -p, one dir each
                                          └──── task_status ◀─── ~/.higgs/herd/*/status.json
                                                                   ~/.higgs/herd/events.jsonl ──▶ Jerrold's 3D scene
```

- **The voice is Donna's mouth, Donna's session is her brain.** Anything substantive goes `delegate_task` → Donna's
  inbox (the call stays open); she answers with `say` (spoken) or `note` (silent progress). Small talk and status come
  from the voice directly.
- **Two voice tools only:** `delegate_task(task)` (unchanged) and `task_status()` (code-built from the herd: who is
  working on what, who is idle, what finished). No `spawn_agent` for the voice; Donna decides when to spawn.
- **Donna's rules (in the `/call` skill):** never do work longer than a minute yourself; `herd.py new <name> --kind
  claude --project DIR` then `herd.py send <name> "<task>"`; watch the workers' outboxes; `bridge.py note <id>` for
  progress, `bridge.py say <id>` for results, ≤3 plain sentences; when the user is not on the line, a `say` rings them.

## 4. The contract on disk (one directory per agent, one event log for everyone)

```
~/.higgs/herd/
  events.jsonl                   # append-only; every state change (the scene tails this)
  donna/                         # kind: session (the interactive Claude Code session running /call)
    meta.json  inbox.jsonl  outbox.jsonl  status.json
  <worker>/                      # kind: claude (headless, --resume'd per task; pre-warmed at new)
    meta.json                    # {name, kind, project, parent: "donna", created}
    inbox.jsonl                  # {id, task, context, from, ts}
    outbox.jsonl                 # {id, kind: note|say, text, ts}
    status.json                  # {state, task_id, task, last_note, started, unread}
```
`state ∈ {starting, idle, working, needs_you, done, dead}`; Donna additionally has `speaking` (set by the bridge while the
voice reads her words) and `on_call`. `status.json` also carries `tasks: {id: {state, task, asked?, ts}}`, one record per
task with `state ∈ {queued, in_progress, needs_you, done, failed}` (§8): readers take state from there, never infer it.

`events.jsonl` lines (the scene needs nothing else):
```
{"ts":…, "ev":"agent.new",      "agent":"reviewer", "kind":"claude", "parent":"donna"}
{"ts":…, "ev":"task.sent",      "agent":"reviewer", "id":"c7…", "task":"review the diff on main", "from":"donna"}   # queued
{"ts":…, "ev":"task.taken",     "agent":"reviewer", "id":"c7…"}                                     # in progress (§8)
{"ts":…, "ev":"task.note",      "agent":"reviewer", "id":"c7…", "text":"reading 14 files"}
{"ts":…, "ev":"task.needs_you", "agent":"reviewer", "id":"c7…", "text":"keep the old parser too?"}  # waiting for the user (§8)
{"ts":…, "ev":"task.sent",      "agent":"reviewer", "id":"9a…", "task":"no, drop it", "from":"voice", "in_reply_to":"c7…"}   # the answer
{"ts":…, "ev":"task.done",      "agent":"reviewer", "id":"c7…", "text":"two issues, both in parser.py"}
{"ts":…, "ev":"task.failed",    "agent":"reviewer", "id":"c7…", "text":"the tests do not run here"}   # instead of task.done
{"ts":…, "ev":"agent.state",    "agent":"reviewer", "state":"idle"}
{"ts":…, "ev":"call.ring",      "agent":"donna", "about":"review finished"}     # Donna walks to the phone
{"ts":…, "ev":"call.answered",  "agent":"donna"}   /  {"ev":"call.ended", …}
{"ts":…, "ev":"voice.speaking", "agent":"donna"}   /  {"ev":"voice.user"}        # who is talking right now
{"ts":…, "ev":"agent.close",    "agent":"reviewer"}
```
A file, not a socket, on purpose: `tail -F` is the integration test; a 20-line websocket broadcaster if the browser
cannot read a local file.

## 5. The MacBook phone ("a simple helper that proactively calls me")

`bridge.py --ring` runs in the background with no call open. It watches Donna's outbox and the herd:
1. Donna writes a `say` while nobody is on the line → the bridge opens a Higgs session on the speaker, seeds
   `Calling about: <text>` (the existing opener makes the voice speak first), logs `call.ring` then `call.answered`.
2. The user talks; `delegate_task` → Donna's inbox as today; `task_status` from the herd.
3. The call ends on "bye"/"that's all" (voice says goodbye, bridge closes the session), or after 60 s of silence,
   or on Higgs's 300 s idle timeout → `call.ended`. Results that land with nobody on the line ring again (one call
   at a time; several results are read in one call).
Same flow on Twilio later: `ring` dials instead of opening the speaker.

## 6. What changes in the repo (Saturday order, each step checkable alone)

1. `herd.py` (one stdlib file): `new / ls / send / capture / close`, the dirs above, writes `events.jsonl` and
   `status.json`; `new --kind claude` pre-warms (`claude -p "ready"` → session id saved in `meta.json`); `send` on a
   claude worker runs `claude -p --resume` and streams notes into `outbox.jsonl`. Check: `herd.py new a --kind fake &&
   herd.py send a "x" && tail -3 ~/.higgs/herd/events.jsonl` shows `agent.new, task.sent, task.done`.
2. `/call` skill → Donna's job description (§3 rules); step 1 registers `donna/` in the herd instead of the global
   inbox. Check: a `/call` session answers one dictated task by spawning a worker and `say`ing its result.
3. `bridge.py`: `session` backend reads/writes `herd/donna/`; `task_status` tool from `status.json`; `--ring` mode
   (§5). Check: `--backend fake --silent --text "…"` unchanged transcript plus the events; then a `say` written to
   Donna's outbox with no call open makes the speaker ring.
4. Hand Jerrold §4 first, before any of 1–3, so the scene is built against the same lines in parallel.
5. Twilio (`E-twilio.md`): replace the speaker/mic with the phone adapter; `ring` dials.
6. Busy-Donna hook (issue #5): the wait loop only runs between tasks, so a `PostToolUse` hook hands Donna new inbox
   lines mid-work. `bridge.py hook` (stdlib, ~20 ms) reads the hook JSON on stdin, acts only when its `cwd` is
   `project` in `donna/meta.json`, reads `inbox.jsonl` from `donna/.hook_offset` (separate from the wait loop's
   `.offset`) and prints `hookSpecificOutput.additionalContext` with each task and its `herd.py reply` lines. The owner
   registers it in `.claude/settings.json` of the folder Donna runs in (or passes it to `claude --settings`):
   ```json
   {"hooks": {"PostToolUse": [{"matcher": "*", "hooks": [
     {"type": "command", "command": "python3 /Users/seongminchang/projects/higgs-hackathon/bridge.py hook"}]}]}}
   ```
   Check: `uv run herd.py send donna ping; echo '{"session_id":"x","cwd":"'$PWD'"}' | python3 bridge.py hook` prints
   the JSON once, nothing the second time, nothing for another `cwd`.

Not Saturday: approvals, context %, more than one level, several voices, real remuda as a backend.

## 7. The pitch sentence

"GPT-Live lets the voice coordinate your agents inside ChatGPT. We built the same thing on Higgs, open, on your own
machine: Donna answers the phone, runs your coding agents, and calls you when the work is done."

## 8. Task lifecycle and when Donna's voice speaks (Oct 24, after two real calls)

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
`herd.py reply NAME ID KIND TEXT`, `KIND ∈ take | note | ask | say | fail`:

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
