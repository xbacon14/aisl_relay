# Hackathon Project Handoff

## Objective

Build a small but complete multi-channel household agent for a hackathon.

The system connects two environments people already use:

- **Telegram** for an adult to plan a child's afternoon using natural language.
- **Alexa / Echo Dot** for the child to follow and complete that routine through voice.

Both channels operate on the same authoritative task state.

The goal is not to build a complete household-management product. The goal is to demonstrate one reliable end-to-end agent experience.

## Product concept

An adult sends a natural-language message through Telegram:

> This afternoon she needs to finish her math homework, tidy her room, practice guitar for 20 minutes, and prepare her backpack.

The agent interprets the message and proposes structured tasks:

1. Finish math homework — SCHOOL
2. Tidy room — HOUSEHOLD
3. Practice guitar — EXTRACURRICULAR — 20 min
4. Prepare backpack — SCHOOL

Before changing state, it asks for confirmation.

After confirmation, the tasks become part of today's afternoon routine.

Later, the child interacts through an Echo Dot:

> "Alexa, open [skill name]."

Alexa reads the current routine and guides the child through it.

The child can say:

> "What's next?"

> "I finished."

> "What's left?"

The same state is visible through Telegram:

> "How is the afternoon going?"

The agent can answer:

> 2 of 4 tasks completed. Math homework and the room are done. Guitar and backpack are still pending.

---

## Hackathon thesis

The project should demonstrate:

> One agent, multiple environments, with each environment serving the person and interaction it naturally fits.

Telegram is appropriate for an adult planning and checking a routine.

Voice is appropriate for a child performing that routine at home without needing to open an app or use a screen.

The channels must not be superficial wrappers around a chatbot. Their environment should materially affect how the agent behaves.

---

# Core demo

Optimize everything for this demo.

## Scene 1 — Adult plans through Telegram

Adult:

> This afternoon she needs to do math homework, tidy her room and practice guitar for 20 minutes.

Agent interprets this as structured data.

```json
[
  {
    "title": "Math homework",
    "category": "SCHOOL"
  },
  {
    "title": "Tidy room",
    "category": "HOUSEHOLD"
  },
  {
    "title": "Practice guitar",
    "category": "EXTRACURRICULAR",
    "durationMinutes": 20
  }
]
```

Bot:

> I understood:
>
> 1. Math homework — school
> 2. Tidy room — household
> 3. Practice guitar — extracurricular, 20 min
>
> Add these to this afternoon?

Adult:

> Yes.

Tasks are persisted.

## Scene 2 — Child uses Alexa

Child:

> Alexa, open [skill name].

Alexa:

> You have three things to do this afternoon. Let's start with math homework.

Child:

> I finished.

Alexa records completion.

Alexa:

> Done. Two left. Next, tidy your room.

Child:

> What's left?

Alexa:

> Tidy your room and practice guitar for 20 minutes.

## Scene 3 — Adult checks Telegram

Adult:

> How is the afternoon going?

Bot:

> 1 of 3 tasks completed. Math homework is done. Tidy room and guitar are still pending.

This completes the primary demo.

---

# Architecture

Keep the architecture minimal.

```text
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
                 │               │
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
```

The backend is the source of truth.

The LLM must never invent task state, completion state, progress, points, or other domain facts.

---

# Agent boundary

Follow this rule:

> AI interprets conversation and chooses actions. The application owns business rules and authoritative state.

The LLM should produce structured commands.

Example:

```json
{
  "action": "PROPOSE_TASKS",
  "tasks": [
    {
      "title": "Math homework",
      "category": "SCHOOL"
    }
  ]
}
```

The application validates and executes those commands.

Do not give the model unrestricted database access or arbitrary code execution.

---

# Minimal domain

Do not over-model the domain.

A task requires approximately:

```text
id
title
category
durationMinutes?
status
order
createdAt
completedAt?
```

Categories:

```text
HOUSEHOLD
SCHOOL
EXTRACURRICULAR
OTHER
```

Statuses:

```text
PENDING
COMPLETED
```

The routine is simply the ordered set of current tasks.

Do not implement scheduling engines, recurrence, complex rewards, calendars, dependencies or workflow systems unless the core demo is already complete.

---

# Minimum backend capabilities

Implement only what the demo requires.

Conceptually:

```text
createTasks(tasks)
getTasks()
getNextTask()
completeTask(taskId)
getStatus()
```

Possible HTTP interface:

```text
POST /api/tasks/batch

GET /api/tasks

GET /api/tasks/next

POST /api/tasks/{id}/complete

GET /api/status
```

Exact naming is not important.

Reliability and simplicity are.

---

# Telegram agent

Telegram is primarily the adult interface.

Required capabilities:

### Create routine

Natural language:

> Add math homework, clean the room and 20 minutes of guitar for this afternoon.

LLM extracts structured tasks.

Always show the proposed interpretation before persistence.

### Confirm

User confirms the proposal.

Only then persist it.

### Status

Natural language such as:

> How is she doing?

> What's left?

> Did she finish everything?

The agent queries authoritative backend state before answering.

Do not answer these questions from conversation history alone.

---

# Alexa interaction

Keep Alexa considerably simpler than Telegram.

Required intents/behaviors:

```text
Launch
What's next?
I'm done
What's left?
```

Natural variations are useful but secondary.

Alexa must query the backend rather than maintaining independent task state.

A launch response can be:

> You have three things this afternoon. Let's start with math homework.

When completing:

> Done. Two left. Next, tidy your room.

When finished:

> You're all done for today.

Do not spend hackathon time building a sophisticated general-purpose voice agent unless the deterministic voice flow already works reliably.

---

# LLM usage

Use the LLM where natural language provides clear value.

Primary use:

```text
Telegram natural language
        ↓
LLM
        ↓
structured task proposal
```

Secondary use, only if time permits:

```text
Telegram question
        ↓
LLM + tools
        ↓
backend query
        ↓
natural response
```

Alexa can initially use deterministic intents backed by API calls.

This is acceptable.

A reliable end-to-end system is more valuable than an ambitious but unstable agent architecture.

---

# Suggested tools

The conversational agent can conceptually have tools such as:

```text
propose_tasks(text)

create_tasks(tasks)

get_tasks()

get_next_task()

complete_task(taskId)

get_status()
```

For consequential mutations, preserve explicit confirmation where appropriate.

Task creation from an LLM interpretation must require confirmation.

---

# Failure handling

Implement simple, visible failure behavior.

Examples:

### LLM cannot confidently parse tasks

Ask the adult to clarify.

### Backend unavailable

Do not pretend the action succeeded.

### Task completion requested when no pending task exists

Respond that the routine is already complete.

### Ambiguous "I'm done"

If there is a clearly active/next task, complete it.

Otherwise ask which task was completed.

### Telegram task creation fails

Tell the user that nothing was added.

### Alexa cannot reach backend

Give a short retry message rather than fabricated state.

---

# Priorities

Work in this exact order unless implementation constraints require otherwise.

## P0 — Shared state

Tasks can be created, queried and completed through the backend.

## P1 — Telegram vertical slice

This must work:

```text
natural-language message
→ LLM extraction
→ confirmation
→ persistence
```

## P2 — Alexa vertical slice

This must work:

```text
launch
→ retrieve next task
→ complete
→ retrieve next task
```

## P3 — Cross-channel demo

Create tasks through Telegram.

Immediately retrieve and complete the same tasks through Alexa.

Check updated status through Telegram.

At this point the hackathon project is complete.

## P4 — Polish

Only after P0–P3 work reliably:

- better conversational responses
- task categories
- duration
- richer status summaries
- nicer Telegram formatting
- more Alexa utterance variations
- logging
- basic observability

---

# Explicit non-goals

Do not implement these before the primary demo works:

- Web administration UI
- mobile application
- authentication system beyond what is strictly required
- multiple households
- multiple children
- complex permissions
- calendar integration
- recurring tasks
- reward marketplace
- sophisticated scheduling
- push notifications
- proactive Alexa behavior
- local LLM inference
- vector database
- RAG
- embeddings
- long-term conversational memory
- multi-agent orchestration
- MCP unless it directly reduces implementation time
- elaborate UI
- infrastructure beyond what is required to expose the demo

Avoid adding technology merely to make the architecture look sophisticated.

---

# Engineering principle

Prefer:

```text
working vertical slice
```

over:

```text
complete architecture
```

Every implementation decision should answer:

> Does this increase the probability that the Telegram → shared state → Alexa → shared state → Telegram demo works reliably?

If not, defer it.

---

# Judging alignment

## Core Requirements & Functionality

Demonstrate one complete workflow across real environments:

```text
Telegram → Agent → Backend → Alexa → Backend → Telegram
```

It must work live.

## Innovation & Theme Alignment

Emphasize that each environment has a different role.

The adult naturally plans through messaging.

The child naturally interacts through voice while performing tasks around the home.

The shared household context connects them.

## Technical Execution & Integration

Show:

- structured LLM output/tool calls
- authoritative backend state
- controlled mutations
- confirmation before task creation
- shared state across channels
- basic failure handling
- real Alexa and Telegram integrations

## Usefulness & Agentic Experience

The system should feel like a household assistant rather than a CRUD task manager.

The adult expresses intent naturally.

The system structures it.

The child receives contextual guidance without opening an application.

The adult can later ask about progress naturally.

---

# Demo reliability

Optimize the final implementation for a 60–120 second live demonstration.

Prepare a known-good example:

> This afternoon she needs to finish her math homework, tidy her room, and practice guitar for 20 minutes.

Before submission:

1. Reset demo state.
2. Run the complete Telegram flow.
3. Verify tasks directly in the backend.
4. Run the complete Alexa flow.
5. Query status from Telegram.
6. Repeat the entire demo at least twice.
7. Fix reliability problems before adding features.

If live Alexa behavior is unreliable, record a successful end-to-end demonstration as backup if hackathon submission rules permit video.

---

# Definition of Done

The project is done when this works reliably:

```text
Adult
  │
  │ natural language
  ▼
Telegram
  │
  │ agent extracts tasks
  ▼
Confirmation
  │
  ▼
Backend
  │
  │ shared authoritative state
  ▼
Alexa
  │
  │ child completes task
  ▼
Backend
  │
  ▼
Telegram
  │
  ▼
Adult sees updated progress
```

Anything beyond this is optional.

Do not expand scope until this complete loop works.