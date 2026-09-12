# Relay — API Contract v1

**Source of truth:** `packages/contract/src/index.ts` (zod schemas + TS types).
This document is the human-readable mirror. If they disagree, the code wins and this file gets fixed.

**Executable version:** `npm run contract:test` (against the mock) or
`RELAY_API_URL=http://<backend> npm run contract:test` (against the real backend).
The backend is P0-done when the second command passes.

## Conventions

| Item | Value |
| --- | --- |
| Base path | `/api` |
| Content type | `application/json` both ways |
| Auth | optional header `X-Relay-Key: <RELAY_API_KEY>`. Backend enforces it only when the env var is set. `GET /api/health` is always open. |
| Ids | opaque strings (UUID). Never parse them. |
| Dates | ISO-8601 strings in UTC |
| Ordering | `GET /api/tasks` and all task arrays are sorted by `order` ascending |
| Errors | every non-2xx body is `{ "error": { "code", "message", "details?" } }` |
| Single household | there is exactly one routine. No user/household ids anywhere in v1. |

## Domain

```ts
Task {
  id: string
  title: string            // 1..120 chars
  category: "HOUSEHOLD" | "SCHOOL" | "EXTRACURRICULAR" | "OTHER"
  durationMinutes: number | null
  status: "PENDING" | "COMPLETED"
  order: number            // 1-based, stable, assigned by backend
  createdAt: string
  completedAt: string | null
}

NewTask {                  // what the Telegram agent sends after confirmation
  title: string
  category?: Category      // defaults to "OTHER"
  durationMinutes?: number | null
}
```

**Next task** = the first `PENDING` task by `order`. Nothing else is "active".

## Endpoints

### `GET /api/health`
`200 { ok: true, contractVersion: "1", store: "memory" | "postgres" }`

### `POST /api/tasks/batch` — create the routine (Telegram, after "yes")
Request `{ tasks: NewTask[] }` (1..20 items)
`201 { tasks: Task[] }` — the created tasks with ids and orders appended after existing ones.
`400 VALIDATION_ERROR`

### `GET /api/tasks`
`200 { tasks: Task[] }` — all tasks, pending and completed, by order.

### `GET /api/tasks/next` — Alexa launch / "what's next"
`200 { task: Task | null, remaining: number }`
`task` is `null` when nothing is pending. **Always 200, never 404**, so the voice handler has one code path.

### `POST /api/tasks/next/complete` — Alexa "I'm done" (no id needed)
`200 CompleteTaskResponse`
`409 ROUTINE_EMPTY` — no tasks exist at all → Alexa: "Nothing is planned yet."
`409 ROUTINE_COMPLETE` — all done → Alexa: "You're all done for today."

### `POST /api/tasks/{id}/complete` — explicit completion (Telegram, or Alexa by name later)
`200 CompleteTaskResponse` — **idempotent**: completing twice returns `alreadyCompleted: true`, no error.
`404 TASK_NOT_FOUND`

```ts
CompleteTaskResponse {
  task: Task               // now COMPLETED
  alreadyCompleted: boolean
  next: Task | null        // the new next pending task
  remaining: number        // pending tasks left after this call
}
```
One call gives Alexa everything for "Done. Two left. Next, tidy your room."

### `GET /api/status` — Telegram "how is the afternoon going?"
```ts
200 {
  total: number
  completedCount: number
  pendingCount: number
  completed: Task[]
  pending: Task[]
  next: Task | null
  allDone: boolean         // total > 0 && pendingCount === 0
}
```
The LLM turns this into prose. It never computes the numbers itself.

### `POST /api/reset` — demo helper
`204`. Deletes every task. Used before each rehearsal.

## Error codes

| code | HTTP | when |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | body/params fail the schema, malformed JSON, unknown route |
| `UNAUTHORIZED` | 401 | missing/wrong `X-Relay-Key` |
| `TASK_NOT_FOUND` | 404 | unknown id |
| `ROUTINE_EMPTY` | 409 | complete-next with zero tasks |
| `ROUTINE_COMPLETE` | 409 | complete-next with nothing pending |
| `INTERNAL_ERROR` | 500 | anything else |

## Client behaviour required by the handoff

Both channels use `RelayClient` from `@relay/contract/client`. It throws `RelayApiError`:

| situation | `err.code` | Telegram says | Alexa says |
| --- | --- | --- | --- |
| backend unreachable / timeout | `NETWORK` (`err.isUnreachable`) | "I couldn't reach the planner, nothing was added." | "I can't check right now. Let's try again in a moment." |
| 409 `ROUTINE_COMPLETE` | | "Everything is already done." | "You're all done for today." |
| 409 `ROUTINE_EMPTY` | | "Nothing is planned yet." | "Nothing is planned yet. Ask a grown-up to add the afternoon." |
| response fails schema | `BAD_RESPONSE` | treat as unreachable | treat as unreachable |

Never answer a status question from conversation memory. Never say "done" unless the call returned 2xx.

## Agent boundary (Telegram only, not an HTTP contract)

The LLM may only emit one of these; the app validates with `AgentCommandSchema` and decides what to do:

```ts
{ action: "PROPOSE_TASKS", tasks: NewTask[] }   // shown to the adult, persisted only after explicit yes
{ action: "GET_STATUS" }
{ action: "COMPLETE_TASK", taskId }
{ action: "CLARIFY", question }                  // low confidence → ask, don't guess
```

## Change policy

- Adding an optional response field: just do it, tell the channel.
- Anything else: post in the team chat, update `index.ts`, the test, and this file in the same commit, bump `CONTRACT_VERSION`.
