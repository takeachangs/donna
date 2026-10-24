# Demo video script: "Donna" (3 minutes, two presenters)

**Seongmin** is on the phone with Donna (EarPods, laptop mic). **Jerrold** stands at the office screen and explains what
the audience is seeing. Screen capture: left half the 3D office (http://127.0.0.1:5183), right half the brain's tmux
window (`tmux attach -t donna`). Donna's audio is captured from the EarPods line; the room mic picks up the two of you.
Start state: `~/projects/donna-demo` is an empty repo, the phone shows `ring: waiting`, the office shows Donna alone.
Exact spoken lines are in quotes; they are the ones rehearsed. Fallbacks are in `docs/demo.md`.

## 0:00 Cold open (Jerrold, 20 s)
J: "This is Donna. She's a secretary you talk to on the phone. Her voice is Higgs Realtime. Her brain is a normal
Claude Code session on your laptop. When you ask for work, she doesn't do it: she hires. Every agent Claude Code
spawns shows up here, in the office. Seongmin, call her."

## 0:20 Pickup and a thin request (Seongmin)
S presses Enter. Donna: "Hey, it's Donna. What do you need?"
S: "Let's build a small focus timer web app."
Donna: "Should I make it a one-page focus timer with twenty-five minutes of work and five-minute breaks, and include both light and dark modes?"
J (over the question): "She didn't guess. The request was thin, so the brain read the repo and came back with a
proposal and one question. That's Claude Code deciding, not the voice."
S: "Yes, and give it a session counter."

## 0:50 Hiring, on screen (Jerrold)
Donna: "Leo and Mia are on it."
J: "Watch the office. Leo and Mia appear in Donna's room while she briefs them, then walk to their desks. The labels
are their current tool calls: writing index.html, running checks. Nothing here is simulated: these are Claude Code
hooks firing inside the workers. Each of them works in its own git worktree."
(Point at the tmux window.) "And this is the brain itself, if you want to watch it think."

## 1:20 Talk while they work (Seongmin)
S: "How's it going?"
Donna: "Leo is building the timer page and logic, and Mia is handling the stylesheet."
S interrupts her mid-sentence: "Actually, sorry, one thing: make the break ten minutes."
Donna stops, listens, and passes it on.
J: "Barge-in is Higgs. The follow-up went to the brain as a correction, and the brain forwards it to the worker who
owns that file."

## 1:50 The result (Donna)
Donna: "Leo built the focus timer with twenty-five minute sessions, five-minute breaks, and a session counter, and Mia handled the light and dark styling. The code is on its own branch."
J: "Leo and Mia go to the lounge. The result came to her as a report; she spoke it when there was a gap in the
conversation. If Seongmin had hung up, the phone would have rung him."

## 2:10 Transfer (Seongmin)
S: "Who built the timer?"  Donna: "Leo."
S: "Put me through to Leo."
Hold cue. A different voice: "Hey, it's Leo."
S: "Why did you pick that interval length?"
Leo answers in first person, from his own work.
S: "Put Donna back on."  Donna: "Hey, it's Donna again."
J: "That was a fresh Higgs session in Leo's voice, and Seongmin's question went into Leo's own Claude Code session,
the same messaging Claude Code uses between agents."

## 2:40 Hang up and callback (Seongmin)
S: "Open a pull request. Thanks, that's all, bye."
Donna: "Will do. Hanging up now."
(Ten to twenty seconds. The phone rings. S presses Enter.)
Donna: "The pull request is up."
J: "She calls you back. That's the whole idea: you keep coding, the office works, the phone rings when it matters."

## 3:00 Close (Jerrold, 10 s)
J: "Higgs Realtime for the voice, Claude Code for the brain and the workers, and a window on it. Built on Higgs this
weekend: the delegation layer, the phone, the transfer. The 3D office is from my earlier project, adapted."

## Notes for filming
- One take per beat is fine; cut between beats. Keep the office in overview; zoom only for the briefing moment.
- If a beat misbehaves, the fallback per beat is in `docs/demo.md` §2; the safest phrases are the quoted ones.
- Do not press Ctrl-C in the phone terminal during the video: "bye" ends the call, Ctrl-C ends the phone.
- Before recording: `curl -s 127.0.0.1:3003/agency-api/health`, `tail -1 bridge.log` shows `ring: waiting`,
  EarPods selected (`audio in: EarPods Microphone | out: EarPods` in the log), `tmux attach -t donna` shows the prompt.
