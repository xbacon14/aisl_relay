# Relay — video narration script (B1 English, 2:00)

Shared mock for the recording: `RELAY_API_URL=https://bodacious-deftly-passover.ngrok-free.dev` (Javier's laptop). Ask Javier for "reset" / "seed" between takes.

## [0:00–0:15] Intro
Hi. This is Relay. Relay is one household routine, in two places. The parent uses Telegram. The child uses Alexa. Both talk to the same backend. The AI never invents the state.

## [0:15–0:45] Scene 1 — Telegram (Ernesto)
Here is the parent. She writes a normal message, in plain language.
> This afternoon she needs to do math homework, tidy her room and practice guitar for 20 minutes.
The AI reads the message and finds three tasks. But nothing is saved yet. The bot asks for confirmation first.
> yes
The parent says yes. Now the three tasks are in the backend.

## [0:45–1:20] Scene 2 — Alexa (Javier, Echo Dot in English US)
Now the child comes home. No screen, no app. Just voice.
- "Alexa, open my afternoon." → *You have three things to do this afternoon. Let's start with math homework.*
  Alexa reads the routine from the backend and says the first task.
- "I'm done." → *Done. two left. Next, tidy your room.*
  The task is marked complete in the backend. Alexa says what comes next.
- "What's left?" → *tidy your room and practice guitar for 20 minutes.*
  Again, this comes from the backend, not from memory.

## [1:20–1:40] Scene 3 — Telegram (Ernesto)
Back to the parent. She asks a simple question.
> How is the afternoon going?
One of three is done. The bot gets these numbers from the backend. The child completed a task by voice, and the parent sees it in Telegram.

## [1:40–2:00] Close
That is the full loop. Telegram, backend, Alexa, backend, Telegram. The AI understands the language. The application owns the truth. If the backend is down, Relay says so. It never says "done" when it is not. Thank you.

Cut first if long: last line of the close, then "Again, this comes from the backend, not from memory."
