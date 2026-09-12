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
