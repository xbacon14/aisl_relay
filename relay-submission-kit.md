# Relay — Submission Kit

**Hackathon:** Agents, Everywhere **Status:** copy-paste ready. Anything in `[brackets]` needs a decision or a fact from the team.

---

## 0\. TL;DR for the team

We are building **Relay**: one household agent living in two environments. A parent plans the afternoon in **Telegram**. The child runs it hands-free on an **Echo Dot**. Both channels read and write the **same authoritative backend state**.

The rule that governs every implementation decision:

> The AI interprets conversation and chooses actions. The application owns business rules and authoritative state.

Ship order: **P0 shared state → P1 Telegram slice → P2 Alexa slice → P3 cross-channel loop → P4 polish.** Nothing from P4 gets touched until the full loop runs twice in a row without a fix.

---

## 1\. Naming

| Field | Value |
| :---- | :---- |
| Project name | **Relay** |
| Alexa invocation | `"Alexa, open my afternoon."` |
| Repo | `relay-household-agent` |
| Telegram bot | `[@relay_household_bot]` |

Why this invocation name: two words, natural for a child, no leading article, no wake-word collision — it passes Amazon's invocation name rules and, more importantly, it survives being said by an eight-year-old across a room.

**Portal title:**

Relay — one household routine, two environments: Telegram for the parent, voice for the child

---

## 2\. Tagline

A parent plans the afternoon in Telegram. The child runs it by voice on an Echo Dot.

Same agent, same state, two environments that each fit the person using them.

---

## 3\. Short description (\~50 words)

Relay is a household agent that lives in two environments at once. A parent describes the

afternoon in plain language over Telegram; the agent structures it into tasks and asks for

confirmation. The child then completes that routine hands-free through an Alexa skill. Both

channels read and write the same authoritative backend state.

---

## 4\. Long description (portal "written description")

THE PROBLEM

Household coordination fails in the gap between the person who plans and the person who

executes. A parent knows what the afternoon should look like. A child is the one moving

around the house doing it. Any tool that forces both of them into the same interface fails

one of them: a shared app is friction for the parent and a screen the child shouldn't be

holding.

WHAT RELAY DOES

Relay is a single agent that appears in two environments, each chosen for the person and the

moment it serves.

The parent opens Telegram — an app already on their phone, already used for family logistics

— and types naturally:

  "This afternoon she needs to finish her math homework, tidy her room,

   and practice guitar for 20 minutes."

The agent interprets this into structured tasks with categories and durations, shows the

interpretation back, and waits for explicit confirmation before writing anything. Only after

confirmation does the routine exist.

The child says "Alexa, open my afternoon" to an Echo Dot in the living room. Alexa reads the

current routine and guides them one task at a time: what's next, what's left, mark this one

done. No screen, no login, no app — the child's hands are busy tidying a room, and voice is

the only interface that survives that.

The parent later asks Telegram "how is the afternoon going?" and gets progress pulled live

from the backend — never from conversation history.

WHY THE ENVIRONMENT IS THE POINT

This is not one chatbot with two front doors. The environments have different roles,

different users, and different affordances:

\- Telegram is asynchronous, text-first, and expressive — right for intent capture and

  planning.

\- Voice is ambient, hands-free, and present in the room where the work happens — right for

  execution.

\- The shared household state is what makes both of them useful at the same time.

Neither channel can be replaced by the other, and neither works as a standalone chatbot. The

parent will not narrate a routine to a smart speaker; the child will not open a messaging app

mid-chore.

ARCHITECTURE AND AGENT BOUNDARY

  Telegram ──► LLM (interpretation \+ tool calls) ──► Backend API ──► PostgreSQL

                                                          ▲

                                    Alexa Skill ──────────┘

The operating rule is strict: the AI interprets conversation and chooses actions; the

application owns business rules and authoritative state. The LLM emits structured commands

(PROPOSE\_TASKS, COMPLETE\_TASK, GET\_STATUS) which the backend validates and executes. The

model has no database access and no arbitrary execution. It cannot invent task state,

completion counts, or progress — every factual answer is a read from PostgreSQL.

Mutations that matter require confirmation. Task creation from an LLM interpretation is never

persisted without an explicit yes from the parent.

FAILURE HANDLING

The system fails visibly rather than plausibly. If the backend is unreachable, Telegram says

nothing was added and Alexa asks the child to try again — neither fabricates success. If the

parse is low-confidence, the agent asks the parent to clarify. If "I'm done" is ambiguous

with no active task, the agent asks which task instead of guessing.

STACK

\[STACK — e.g. TypeScript, Node, PostgreSQL, Telegram Bot API, Alexa Skills Kit,

OpenRouter for structured extraction, deployed on Google Cloud Run\]

BUILT DURING THE HACKATHON

The backend, the domain model, the Telegram agent and tool layer, the Alexa skill and its

intent handlers, and the cross-channel state contract were all built during the event.

\[Adjust to the truth if we reuse boilerplate — judges may ask.\]

---

## 5\. The demo (memorize this)

Three scenes. This exact wording is the known-good path — rehearse with it, don't improvise on stage.

**Scene 1 — parent, Telegram**

> This afternoon she needs to do math homework, tidy her room and practice guitar for 20 minutes.

Bot replies with the interpretation and asks to confirm. Parent says yes. Only now is anything written.

**Scene 2 — child, Echo Dot**

> "Alexa, open my afternoon." → "I finished." → "What's left?"

**Scene 3 — parent, Telegram**

> How is the afternoon going?

Bot: `1 of 3 completed. Math homework is done. Tidy room and guitar are still pending.`

---

## 6\. Architecture

                  ┌──────────────┐

                  │   Telegram   │

                  └──────┬───────┘

                         │

                         ▼

                 ┌───────────────┐

                 │ Agent / LLM   │

                 │ interpretation│

                 └───────┬───────┘

                         │

                         ▼

                 ┌───────────────┐

                 │  Backend API  │

                 │ business rules│

                 │ task state    │

                 └───────┬───────┘

                         │

                         ▼

                    PostgreSQL

                         ▲

                         │

                  ┌──────┴──────┐

                  │ Alexa Skill │

                  └─────────────┘

### Domain

Task: id, title, category, durationMinutes?, status, order, createdAt, completedAt?

Category: HOUSEHOLD | SCHOOL | EXTRACURRICULAR | OTHER

Status: PENDING | COMPLETED

Routine \= the ordered set of current tasks. Nothing more.

### API surface

POST /api/tasks/batch

GET  /api/tasks

GET  /api/tasks/next

POST /api/tasks/{id}/complete

GET  /api/status

### Agent tools

propose\_tasks(text)   create\_tasks(tasks)   get\_tasks()

get\_next\_task()       complete\_task(id)     get\_status()

`create_tasks` always requires explicit user confirmation. No exceptions.

---

## 7\. Work split (suggested)

| Owner | Scope | Done when |
| :---- | :---- | :---- |
| `[name]` | Backend \+ schema \+ the five endpoints | curl creates, lists, completes, and reports status |
| `[name]` | Telegram bot \+ LLM extraction \+ confirmation flow | the known-good sentence produces 3 correct tasks in the DB |
| `[name]` | Alexa skill: Launch, NextTask, Done, WhatsLeft | full launch→complete→next loop works on a real device |
| `[name]` | Demo, video, README, submission | loop rehearsed twice clean, video cut, repo public |

**Contract first.** Agree on the five endpoint shapes in the first 20 minutes so Telegram and Alexa can be built against a stub in parallel. Whoever owns the backend publishes the response JSON before writing the handlers.

---

## 8\. Video script (2:00 hard cap)

| Time | Content |
| :---- | :---- |
| 0:00–0:12 | To camera: "A parent plans the afternoon. A child does it. Those are two different people in two different rooms, and no single app serves both." |
| 0:12–0:20 | Architecture diagram. One line: "One agent, one state, two environments." |
| 0:20–0:50 | Telegram screen. Type the known-good sentence. Interpretation appears. "It never writes until I confirm." Confirm. |
| 0:50–1:25 | Camera on the Echo Dot. Launch → "I finished." → "What's left?" **One unbroken take, no cuts inside this block.** |
| 1:25–1:45 | Back to Telegram. Ask for progress. Say out loud: "That number came from the database, not from the chat history." |
| 1:45–2:00 | Close on the agent boundary and one failure case. "The model proposes. The application decides." |

Record the Alexa block separately and keep the best single take. It is the highest-risk segment and it carries the most weight in the Core Requirements score.

---

## 9\. Social post

We built Relay for the Agents, Everywhere hackathon 🏠

One agent, two environments: a parent plans the afternoon in Telegram in plain

language, and the child runs that routine hands-free on an Echo Dot. Same

authoritative state on both sides — the model interprets, the backend decides.

The environment isn't a wrapper. Voice is the only interface that works when

your hands are busy tidying a room.

Repo \+ demo 👇

\[link\]

@AITinkerers @OpenAI @OpenRouterAI @Auth0 @ExaAILabs @CopilotKit @trigger\_dev @mozilla @googlecloud

\#AgentsEverywhere \#AITinkerers

Verify every handle before posting, and **delete the sponsors we didn't actually use.** Tagging all of them without touching their tools is noticeable.

---

## 10\. Scoring notes

The rubric rewards two things we already have in the design. Make them visible in the demo instead of leaving them buried in the code.

**Innovation, score 5 — "a surprising new agent pattern whose central value could not be reproduced in a standalone chatbox."** Say it nearly verbatim: a chatbot cannot be in the kitchen while the child is tidying a room. The parent will not narrate to a speaker; the child will not open a messaging app mid-chore.

**Technical Execution, score 5 — "thoughtful failure handling."** If there are ten seconds left in the video, kill the backend on camera and show Alexa saying "let me try again" instead of inventing state. This is the detail that separates a 4 from a 5, and almost nobody demonstrates it.

---

## 11\. Pre-submission checklist

- [ ] Reset demo state  
- [ ] Full Telegram flow: message → interpretation → confirm → persisted  
- [ ] Verify the three tasks directly in PostgreSQL  
- [ ] Full Alexa flow: launch → next → complete → next → done  
- [ ] Status query from Telegram shows correct progress  
- [ ] Repeat the entire loop a second time, clean, no fixes in between  
- [ ] Repo is **public** and the README has the diagram and the run instructions  
- [ ] Video is under 2:00 and the Alexa block is uncut  
- [ ] Social post published with correct handles  
- [ ] Everyone can answer: which parts were built during the event?

---

## 12\. Non-goals — do not build these

Web admin UI · mobile app · auth beyond the minimum · multiple households · multiple children · permissions · calendar integration · recurring tasks · rewards · scheduling engine · push notifications · proactive Alexa · local inference · vector DB · RAG · embeddings · long-term memory · multi-agent orchestration · MCP (unless it saves us time today) · elaborate UI

If someone proposes work, it has to answer yes to this:

> Does this increase the probability that the **Telegram → state → Alexa → state → Telegram** demo works reliably?

If not, it waits.  
