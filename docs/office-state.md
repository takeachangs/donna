# Office state: the one contract between Donna's brain and the office view

Decided Oct 24 ~07:00. The office (`office/`, from Jerrold's Chamber) is a **display only**: a Node server that serves
the page and streams one JSON file over its WebSocket, and the Three.js scene that draws it. No Higgs, no prompts, no
executors, no git in the office. The voice is `bridge.py`/`higgslive.py`; the brain is the user's interactive Claude Code
session running `/call`; workers are whatever the brain spawns with the Agent tool. Claude Code dispatches; we draw.

## The file: `~/.higgs/office.json` (`$HIGGS_HOME/office.json`)
Written atomically (tmp + rename) by `herd.write_office()`: on every Claude Code hook event (`herd.py hook <Event>`,
registered by `hooks/office.json`) and every second while `bridge.py` runs; read by the office server, which broadcasts `{"type":"workspace","workspace":<file>}` on every change (and a `call` field),
and by the voice's `task_status` (`higgslive.office_status`: the workers by status and the `queued` briefings, #43).
Shape = the office's existing `Workspace` type (`office/apps/web/src/agency/types.ts`) plus `call`, so the scene is unchanged:

```jsonc
{
  "revision": 42,                       // increases on every write
  "call": {"state": "off"},             // off | ringing | listening | thinking | speaking  (from bridge.py's state file)
                                        // + "with": "<worker id>" | "donna" while a call is on: who the person talks to (#28)
  "secretary": {"id":"mara","name":"Donna","role":"Secretary","voice":"nora","characterKey":"char-female-b"},
  "projects": [{"id":"<cwd slug>","name":"<repo dir name>","goal":"<first task>","memory":{"outcome":"","checkpoint":"","latest":"<last say>","nextStep":"","updatedAt":"<iso>"}}],
  "workers": [
    {"id":"brain-<session>","projectId":"<cwd slug>","name":"Donna","role":"Brain","responsibility":"","characterKey":"char-female-b","status":"working","currentAction":"Read dash.py","lead":true},
    {"id":"<agentId>","projectId":"<cwd slug>","name":"<Agent name>","role":"<Agent description>","responsibility":"","characterKey":"char-male-b","voice":"jake","status":"working","currentAction":"Edit herd.py"}
  ],
  "assignments": [{"id":"<agentId>","projectId":"<cwd slug>","workerId":"<agentId>","title":"<Agent description>","brief":"<Agent prompt>","acceptance":"","status":"working","cwd":"<cwd>","summary":"<final report, when done>","startedAt":"<iso>","completedAt":"<iso>"}],
  "decisions": [{"id":"<task id>","projectId":"<cwd slug>","title":"<ask text>","context":"","status":"open","createdAt":"<iso>"}],
  "briefings": [{"id":"<task id>","projectId":"<cwd slug>","workerId":"<agentId of the worker who did it, or the brain row>","title":"<say text, first 60 chars>","summary":"<say text>","status":"queued|presented","contributors":[{"name":"<worker names, exactly as in workers[].name>"}],"createdAt":"<iso>"}],
  "activity": [{"at":"<iso>","projectId":"<cwd slug>","message":"<herd event>"}]
}
```
Status words (`WorkStatus`): queued | working | waiting | review | done | paused | failed. A worker is `working` from its
`SubagentStart` (or its Agent `PostToolUse`) until its `SubagentHandback` report or `SubagentStop` (a teammate: its own `Stop`); `done` after.
A background Agent call starts the row over (`working`, no summary), also for a name used before (#65). A worker's `currentAction` is
"Hired: <description>" until its first tool, then that tool in words, at most 40 chars ("Writing index.html", "Running checks",
"Running a command", "Committing the work", "Searching the code").
Who is drawn (#44): agents started in this duty period (`since`, below) whose Agent call gave a `name` (the row's name) or a
`description` (its first 3 words), minus unnamed `Explore`/`Plan` helpers. A `SubagentStop` for an agent with no
`SubagentStart` and no Agent call makes no row: Claude Code's own helpers fire one (`agent_type` "") after the brain's turns. Hooks
carry no failure signal, so `failed` comes only from the transcript fallback. The brain row is `lead: true`: `waiting`
while a herd `ask` is open, `working` while its turn runs (last `UserPromptSubmit`/`PostToolUse` after the last `Stop`),
`waiting` while its workers are still out (#65), else `done`. Its `currentAction` is Donna's narrative (#65; the office shows it as "Donna: …" under the call pill and on her desk):
"Thinking" (a prompt and no tool since), from her last tool "Reading the repo" (Read/Glob/Grep), "Setting up a workspace" (git worktree),
"Hiring Ava for: <description>" / "Hiring Ava and Ben" (her trailing Agent calls), "Running checks", "Reporting" (herd note/say/fail),
"Asking you" (ask), "Talking to <to>" (SendMessage), else "Working on it"; when her turn is over "Waiting on Ava and Ben" (workers still
working), "Waiting for your answer" (open ask) or "Ready". `char-female-a` does not exist in the office's assets: Donna is `char-female-b` (the office's own default),
workers rotate over the other five keys. Beyond the shape above the producer also fills the arrays the display maps over:
`Worker.assignmentId`, `Assignment.{artifacts,dependsOn,revision}`, `Briefing.{assignmentId,workerId,deliveryKey,
artifacts,verification}`; `contributors` are the workers that started between the task and its `say` (exact `name`s), and the first of them is
`workerId`/`assignmentId` (else the lead's id and "").

## Sources on the brain side (Python, this repo)
Decided Oct 24 07:15 (issue #26 comment): the office is an event listener, fed by Claude Code hooks.
- `hooks/office.json` registers `python3 $HOME/projects/higgs-hackathon/herd.py hook <Event>` for `SubagentStart`,
  `SubagentStop`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `Notification`. Install per session with
  `claude --settings ~/projects/higgs-hackathon/hooks/office.json` (preferred: merged into a project's
  `.claude/settings.local.json` it fires for every session in that folder, and the brain filter has to drop them).
  Each call appends one compact line to `~/.higgs/events.jsonl` and re-renders `office.json` (idempotent reducer over
  the last 1 MB of that log). Measured ~35-45 ms per call.
- What the hooks carry (Claude Code 2.1.309, captured): every input has `session_id`, `cwd`, `transcript_path`; inside a
  subagent also `agent_id`/`agent_type`. The brain's `PostToolUse(Agent)` has `tool_input.{name,description,prompt}` and
  `tool_response.agentId` (`status: "async_launched"` for a background agent; a foreground one carries the result).
  `SubagentStart` (only `agent_id`/`agent_type`, no name or description; before that `PostToolUse` for a foreground agent,
  after it for a background one), subagent `PostToolUse` (→ `currentAction`), its
  `SubagentHandback` call (`tool_input.message` = the report → `summary`), `SubagentStop` (no result; its
  `background_tasks` still say "running"), `Stop` (`last_assistant_message`, `background_tasks`). The report reaches the
  brain as a `UserPromptSubmit` starting `<agent-message from="<name>">`. `Notification` is logged and ignored.
  That is headless (`claude -p`). **Interactive, with agent teams on** (this machine: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`,
  `teammateMode: "tmux"`; probed Oct 24, #65), a *named* background Agent is a **teammate**: its own `claude` process in a tmux pane
  (`--agent-id Ava@session-<brain's first 8> --agent-name Ava --team-name session-<8> --parent-session-id <brain session>`, and the
  brain's `--settings`, so our hooks fire in it). No `SubagentStart`; the brain's `PostToolUse(Agent)` has `tool_response.status:
  "teammate_spawned"` (no result) and `agentId: "Ava@session-<8>"`; the teammate's `PostToolUse`/`Stop` (+ `TeammateIdle` with
  `teammate_name`/`team_name`) carry ITS session_id and no `agent_id`; its transcript is a top-level `<its session>.jsonl` (lines carry
  `agentName`/`teamName`), no `subagents/` dir. Its report reaches the brain as a `<teammate-message>` without any hook. The bare
  `SubagentStop`s (`agent_type` "") ~2 s after each brain `Stop` are Claude Code's own helpers. So `herd.py hook` reads its parent
  process's args (`ps`, ~4 ms) and tags a teammate's event `agent=<--agent-id>`, `type: "teammate"`, `session=<--parent-session-id>`:
  from there it is an ordinary subagent of the brain; its `Stop` = done, with `last_assistant_message` as the summary.
- Which session is the brain: `/call` step 1 runs `herd.py new donna`, which forgets the old `session`; the hook that
  fires on that Bash call writes the new `session_id` into `~/.higgs/herd/donna/meta.json`. No session recorded = no
  hooks (step 1 checks this). Without one, the newest brain event from the project dir decides.
- Fallback without hooks: `dash.py`'s `find_orch` + `parse_transcript` on `~/.claude/projects/<slug>/<session>.jsonl`
  (Agent tool_use → worker rows, task notifications → done/failed). Hooks carry the Agent prompt, so nothing else needs it.
- Herd: `~/.higgs/herd/donna/{inbox,outbox,status}`, `herd/events.jsonl` → decisions (open `ask`), briefings (`say`), activity.
  Only the current duty period counts (#31): lines at or after `donna/meta.json` `since`, which every `herd.py new donna`
  (/call step 1) resets. Briefings are the last 10 `say`s of that period, `queued` until a `task.spoken` event names their id
  (`bridge.py` writes it when the result goes into the call, or when a ring call opens with it), then `presented`; the scene
  walks only `queued` ones. Decisions are the period's open asks; activity is the period's last 20 herd events.
- Call state: `bridge.py` writes `~/.higgs/state.json` `{"state": "off|ringing|listening|thinking|speaking"}` every
  250 ms, `off` last (Mike's contract); the producer reads a file older than 3 s as `off` (a crashed bridge).
- Transfer (#28): the state file also carries `"with": "<name>"` while a call is on ("donna", or the worker the person was
  put through to). The producer gives `call.with` the id of the worker with that name (else "donna"); the scene walks that
  worker to the phone in Donna's suite for the duration and back after, and the call pill reads "On the line: <name>".
  `workers[].voice` is the Higgs voice a worker speaks in when put through: by the look's gender, round-robin in order of
  appearance (female chloe, eleanor, nora; male jake, marcus, oliver; nora last because Donna is nora).

## Contracts that must not drift (change every side in the same commit)
- `office.json` shape above; `WorkStatus` words; `call.state` words.
- `~/.higgs/state.json` written by `bridge.py`, read by the producer (3 s staleness = `off`).
- `hooks/office.json` event list ↔ `herd.py hook` / `office()` reducer.
- Herd line shapes (`docs/herd.md`), `in_reply_to` for answers to `ask`.
- The voice's sign-off (`SIGN_OFF = "Hanging up now."`) and pickup lines live in `bridge.py` only.

## Decided during #25 (Oct 24 07:35)
- Character keys that ship: `char-male-a`, `char-male-b`, `char-male-d`, `char-female-b`, `char-female-d`, `char-female-e`. Donna is `char-female-b`. An unknown key draws a placeholder.
- A briefing carries `workerId`; the scene uses it for the desk → Donna walk. Contributor names must equal `workers[].name`.
- A finished worker (`done`/`failed`) rests in the lounge on their own, regardless of the rest of the project.
- A file that exists but is not a JSON object is "missing" for the office: Donna alone, health `state: 'missing'`.

## Decided during #65 (Oct 24 12:00)
- A worker id the scene has never seen spawns at the phone by the entrance (`phoneSpot`) and walks to its desk (`entranceRoute`);
  known ids keep their desk or lounge seat; on page load everyone present counts as seen. Desk screens show the worker's
  `currentAction` while `working` (else the role), Donna's screen her narrative; both repaint in place (no NPC rebuild).
- The skill gives every new task new first names (a teammate's id is its name, so a reused name is the same row).
- Earlier signals (#65 follow-up): a task the voice sent and the brain has not taken (`status.json` state `queued`, < 10 min) is a
  `queued` assignment (`workerId` = the lead) and Donna's line reads "Got it: <task>"; `take` makes it "Reading the repo".
  A first name (allow-list `herd.FIRST`) in the brain's `note`/`ask` that is not a row yet is a provisional worker
  `{"id": "brief-<Name>", "status": "queued", "currentAction": "Being briefed", "role": ""}` for up to 10 min; the scene stands it
  in Donna's suite (no desk, no lounge) until the spawn's row (same name, new id) replaces it and walks to a desk. The skill sends
  that note just before the Agent calls. The voice's status tool leaves `queued` workers out.
- The sync is tested end to end offline: `uv run tests/office_sync.py` replays a recorded brain run (`tests/fixtures/office_run.jsonl`:
  delegate, take, hiring note, 2 background workers, their tools and stops, say, spoken) through herd's own send/reply/hook and
  checks the office.json timeline; `--snapshots office/tests/fixtures/office-sync.json` feeds `office/tests/office-sync.test.ts`
  (seats, briefing spots, desk captions, labels, `adapt()`). Re-record: `uv run tests/record_office_events.py run <out>` (headless
  Sonnet, ~1 min) or, on a live brain, its `settings` + `export`.
