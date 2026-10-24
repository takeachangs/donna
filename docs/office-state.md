# Office state: the one contract between Donna's brain and the office view

Decided Oct 24 ~07:00. The office (`office/`, from Jerrold's Chamber) is a **display only**: a Node server that serves
the page and streams one JSON file over its WebSocket, and the Three.js scene that draws it. No Higgs, no prompts, no
executors, no git in the office. The voice is `bridge.py`/`higgslive.py`; the brain is the user's interactive Claude Code
session running `/call`; workers are whatever the brain spawns with the Agent tool. Claude Code dispatches; we draw.

## The file: `~/.higgs/office.json` (`$HIGGS_HOME/office.json`)
Written atomically (tmp + rename) by the brain-side producer at least once per second while a brain is on duty, read
by the office server, which broadcasts `{"type":"workspace","workspace":<file>}` on every change (and a `call` field).
Shape = the office's existing `Workspace` type (`office/apps/web/src/agency/types.ts`) plus `call`, so the scene is unchanged:

```jsonc
{
  "revision": 42,                       // increases on every write
  "call": {"state": "off"},             // off | ringing | listening | thinking | speaking  (from bridge.py's state file)
  "secretary": {"id":"mara","name":"Donna","role":"Secretary","voice":"nora","characterKey":"char-female-a"},
  "projects": [{"id":"<cwd slug>","name":"<repo dir name>","goal":"<first task>","memory":{"outcome":"","checkpoint":"","latest":"<last say>","nextStep":"","updatedAt":"<iso>"}}],
  "workers": [
    {"id":"brain-<session>","projectId":"<cwd slug>","name":"Donna","role":"Brain","responsibility":"","characterKey":"char-female-a","status":"working","currentAction":"Read dash.py","lead":true},
    {"id":"<agentId>","projectId":"<cwd slug>","name":"<Agent name>","role":"<Agent description>","responsibility":"","characterKey":"char-male-b","status":"working","currentAction":"Edit herd.py"}
  ],
  "assignments": [{"id":"<agentId>","projectId":"<cwd slug>","workerId":"<agentId>","title":"<Agent description>","brief":"<Agent prompt>","acceptance":"","status":"working","cwd":"<cwd>","summary":"<final report, when done>","startedAt":"<iso>","completedAt":"<iso>"}],
  "decisions": [{"id":"<task id>","projectId":"<cwd slug>","title":"<ask text>","context":"","status":"open","createdAt":"<iso>"}],
  "briefings": [{"id":"<task id>","projectId":"<cwd slug>","title":"<say text, first 60 chars>","summary":"<say text>","status":"queued","contributors":[{"name":"<worker names>"}],"createdAt":"<iso>"}],
  "activity": [{"at":"<iso>","projectId":"<cwd slug>","message":"<herd event>"}]
}
```
Status words (`WorkStatus`): queued | working | waiting | review | done | paused | failed. A worker is `working` from its
Agent tool_use until its task notification; `done` after; `failed` on an error notification; `waiting` while the
brain's `ask` for it is open. The brain row is `lead: true`; status working while its turn runs, idle = `done`.

## Sources on the brain side (Python, this repo)
- Which session is the brain: `/call` step 1 records it in `~/.higgs/herd/donna/meta.json` as `"session"` (the
  `bridge.py hook` PostToolUse call receives `session_id`; dash.py's `find_orch` is the fallback).
- Transcript: `~/.claude/projects/<slug>/<session>.jsonl` and `.../subagents/agent-<id>.jsonl`; `dash.py` already
  parses Agent tool_use → worker rows, task notifications → done, last tool_use → currentAction.
- Herd: `~/.higgs/herd/donna/{inbox,outbox}.jsonl`, `events.jsonl` → decisions (open `ask`), briefings (`say`), activity.
- Call state: `bridge.py` writes `~/.higgs/state.json` `{"state": "off|ringing|listening|thinking|speaking"}` (Mike's contract).

## Contracts that must not drift (change every side in the same commit)
- `office.json` shape above; `WorkStatus` words; `call.state` words.
- `~/.higgs/state.json` written by `bridge.py`, read by the producer.
- Herd line shapes (`docs/herd.md`), `in_reply_to` for answers to `ask`.
- The voice's sign-off and pickup lines live in `bridge.py` only.
