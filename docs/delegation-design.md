# Delegation layer for Higgs Realtime — design notes (from GPT-Live's client delegation)

Source: developers.openai.com/api/docs/guides/live-delegation (+ live-prompting, live-conversations), read 2026-10-22.

## What GPT-Live does
- Voice model decides to delegate → server emits `session.delegation.created` {`delegation.id`, `offset_ms`}. No task text:
  the client rebuilds the task from the running transcripts (`session.input_transcript.delta` / `session.output_transcript.delta`).
- Client returns info on THREE channels, each `{delegation_id, content}` (content ≤ 500 tokens, plain text):
  - `session.commentary.append` — **spoken**: the voice paraphrases it aloud.
  - `session.thinking.append` — **silent**: context the voice can use if the user asks ("is it done?" → "still on step two").
  - `session.instructions.append` — steer the voice; can interrupt current speech.
  Acks (`*.appended`) confirm context injection, not speech.
- Multiple updates per delegation are allowed: progress as several thinking/commentary appends, then the final commentary.
- Interrupting speech does NOT cancel backend work; results still get appended. Mute doesn't stop work either.
- Guidance: send commentary "when something useful changes: a step finishes, a delay matters". Discard outdated results if the user changed the request.
- Prompting: voice prompt has sections **Backchannel policy / Interruption policy / Delegation policy**. Key lines:
  "Do not guess the result while waiting"; "wait for the backend's result before … reporting that an action is complete".
  Keep Markdown/JSON/reasoning in the backend. Backend prompt template: "## Voice conversation context" … "## Return the result" (facts, status, next step).

## Mapping onto Higgs Realtime (what our layer provides)
| GPT-Live | Higgs implementation |
| --- | --- |
| `session.delegation.created` | model calls function tool `run_task(task)`; we answer `{"status":"started","id"}` at once |
| `commentary.append` | user-role text item "[result for task]: …" + bare `response.create`, after speaker drained + 1 s |
| `thinking.append` | user-role text item "[progress on task]: …" with **no** `response.create` (silent; used if asked) |
| `instructions.append` | `session.update` with amended `instructions` (per-response overrides are broken: greeting bug) |
| transcript to rebuild task | not needed: the tool call carries the task text (an advantage over GPT-Live) |
| 500-token cap | cap injected text at ~800 chars |

## Progress (the user's "it should show progress" question)
- **Voice:** progress is the thinking channel. Inject each backend step silently; the voice only mentions it if asked or if a step matters. Spoken "still working" only when a delay matters (e.g. > 20 s), per OpenAI's guidance.
- **Screen:** list pending tasks with their latest progress line (Mike's notch "thinking" state is the same idea).
- **Source of progress for free:** `claude -p --output-format stream-json` emits every tool call; map "Write calculator.html" / "Bash: open …" to one-line progress notes.

## Prompt structure to adopt (voice model)
```
## Role            Sam, the user's voice assistant. No set topic.
## Delegation      run_task for anything to be done/looked up. Call first, speak second. Do not guess the result while waiting;
                   never report an action complete until the result arrives. Progress notes may arrive; mention only if asked.
## Backchannel     short acks ("on it", "mm-hm?"); never read code, JSON or paths aloud.
## Interruption    if interrupted, stop; the task keeps running; resume when the result lands.
```
## Backend prompt to adopt (claude -p)
```
## Voice conversation context   <last ~6 turns>
## Task                          <task text>
## Return the result             ≤ 3 sentences: facts, status, next step. No code, no markdown.
```

## Final API (Oct 23) — `higgslive.py`
Same shape as the OpenAI live SDK so a GPT-Live bridge ports by changing the import:
```python
async with higgslive.connect(playback=True) as conn:            # BOSON_API_KEY; playback=False for headless tests
    await conn.session.start(session={"instructions": PROMPT, "delegation": {"type": "client"}, "voice": "nora",
                                      "input": [developer message]})   # seed folded into the prompt (Higgs has no developer role)
    async for ev in conn:   # session.started | session.delegation.created {delegation.id, delegation.task, offset_ms}
                            # session.output_audio.delta {delta b64} | session.input_transcript.done | session.output_transcript.delta/.done
                            # session.input_speech_started (barge-in: clear your playback) | session.commentary.appended | session.closed | error
    await conn.input_audio.append(pcm16)                                   # conn.input_text.append(str) for typed turns
    await conn.session.thinking.append(content, delegation_id)             # silent; never sent to Higgs, the latest note per task feeds agent_status
    await conn.session.commentary.append(content, delegation_id)           # spoken; waits for idle voice + quiet user + drained playback + 1 s,
                                                                           # then returns the REAL function_call_output for the still-open call + bare response.create
    await conn.session.instructions.append(content)                        # session.update with the amended prompt
```
Inside the layer: the function tool is `delegate_task(task)` (`delegate` is reserved server-side). Higgs tool calls are ASYNCHRONOUS (confirmed
with a Boson engineer + probe, Oct 23): the call stays open while the conversation continues, so the layer returns no output at call time, just a
bare response.create for the acknowledgement, and the backend's answer later becomes the call's actual output. The mechanics
prompt (rule one: call at once, never ask permission; reply to what the user just said; never guess; agent_status for progress) is appended to the app's instructions; one
nudge per user turn when the voice claims a task without calling; a spoken "taking longer" note at 25 s; `tool_choice` always auto.
Findings along the way: assistant-role thinking notes make the model continue them and invent results (reverted to user role + delete);
`create_response: false` is ignored so a classifier cannot gate the reply; `usage` is always null; context window is 32k (models endpoint).
