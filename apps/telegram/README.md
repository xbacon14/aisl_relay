# @relay/telegram — P1, the adult's channel

**Scope:** grammY bot. Natural language → LLM → `PROPOSE_TASKS` → show interpretation → wait for explicit yes → `POST /api/tasks/batch`. Status questions → `GET /api/status` → prose.

**Done when:** the known-good sentence produces 3 correct rows in the backend, and "how is the afternoon going?" answers from `/api/status`, not from chat history.

## Rules from the handoff
- Only `RelayClient` talks to the backend. Import from `@relay/contract/client`.
- LLM output must parse with `AgentCommandSchema` (from `@relay/contract`). If it doesn't, or it returns `CLARIFY`, ask the adult; never persist.
- Confirmation is a real state machine: store the pending proposal per chat, persist only on an affirmative reply (or an inline button), discard on anything else.
- On `RelayApiError` say nothing was added. On success, reply from the returned `tasks`, not from the proposal.
- Use OpenRouter (sponsor) via its OpenAI-compatible endpoint with JSON/structured output. Env: `OPENROUTER_API_KEY`, `MODEL`.

## Env
`TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`, `MODEL`, `RELAY_API_URL`, `RELAY_API_KEY`.

Create the bot with @BotFather. Long polling is enough for the demo; no webhook needed.

## Commands (deterministic — they never touch the LLM)

`/status` `/tasks` `/next` `/done` `/reset` `/health` `/cancel`

These are the escape hatch: if OpenRouter is slow or down mid-demo, every scene
except the initial dictation can still be driven from these. Register them in
BotFather so they show in the menu:

```
status - How the afternoon is going
tasks - The full list
next - What's next
done - Complete the next task
reset - Clear the afternoon
cancel - Discard a pending proposal
```

## Reliability notes

- The OpenRouter call has a 12 s timeout and one retry (the retry also drops
  `response_format`, which some free providers reject).
- Model output is unwrapped from markdown fences / prose before `JSON.parse`;
  `AgentCommandSchema` is still the only gate.
- `COMPLETE_TASK` carries the *title* the adult used; it is resolved against
  `GET /api/tasks` and falls back to `POST /api/tasks/next/complete`. The model
  never sees or invents an id.
- An unrecognized reply to a proposal re-asks instead of discarding it; only an
  explicit no, the Cancel button or `/cancel` drops it. Proposals expire after
  10 minutes.
- A failed create keeps the proposal so "yes" can be retried.
- One message at a time per chat; startup logs a `GET /api/health` result.

Pure logic lives in `src/parse.ts` and is covered by `src/bot.test.ts`
(`npm run verify` runs it).
