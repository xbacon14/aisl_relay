# Relay

One household agent in two environments. A parent plans the afternoon in **Telegram**; the child runs it by voice on an **Echo Dot**. Both read and write the same backend state.

> The AI interprets conversation and chooses actions. The application owns business rules and authoritative state.

Docs: [CONTRACT.md](CONTRACT.md) · [docs/handoff.md](docs/handoff.md) · [docs/submission-kit.md](docs/submission-kit.md) · [hackathon rules & rubric](docs/starter-kit/)

## Layout

```
packages/contract   shared types, zod schemas, typed HTTP client, in-memory mock server, contract test
apps/backend        Express + Postgres. Source of truth.                      (owner: @xbacon14 Italo Golin)
apps/telegram       grammY bot + OpenRouter extraction + confirmation flow.   (owner: @Ernestolop Ernesto Deggeller)
apps/alexa          ASK SDK skill: Launch / NextTask / Done / WhatsLeft.      (owner: @256javy Javier Villalba)
```

Stack: Node ≥ 20, TypeScript, Express, PostgreSQL, npm workspaces. Everything is ESM.

## Day-one setup (everyone)

```bash
npm install
cp .env.example .env
npm run verify             # typecheck + contract test, must stay green
npm run mock               # contract mock on :3000 — build your channel against this
MOCK_SEED=1 npm run mock   # same, pre-loaded with the 3 demo tasks
```

Point your app at the mock with `RELAY_API_URL=http://localhost:3000`. When the real backend is up, only that variable changes.

```bash
npm run dev:backend | dev:telegram | dev:alexa
```

## Work split

| Owner | Scope | Done when |
| --- | --- | --- |
| backend | `apps/backend`: Postgres schema, the 7 routes in CONTRACT.md, deploy to a public URL | `RELAY_API_URL=<public url> npm run contract:test` passes |
| telegram | `apps/telegram`: bot, LLM → `PROPOSE_TASKS`, confirmation, status in prose | the known-good sentence yields 3 correct rows in Postgres; "how is it going?" reads from `/api/status` |
| alexa | `apps/alexa`: skill model + handlers, hosted endpoint | launch → "I finished" → "what's left?" works on a real device against the mock, then against the backend |

Rules of engagement:

1. **The contract is frozen for v1.** Changes go through `packages/contract` first (see change policy in CONTRACT.md).
2. Nobody blocks on anybody: channels use the mock, backend uses the contract test.
3. Ship order P0 → P1 → P2 → P3. No P4 polish until the whole loop runs twice clean.
4. The LLM never invents task state. Every fact the user hears comes from a backend response.

## Demo (known-good path)

1. `curl -X POST $RELAY_API_URL/api/reset`
2. Telegram: *"This afternoon she needs to do math homework, tidy her room and practice guitar for 20 minutes."* → confirm.
3. Echo Dot: *"Alexa, open my afternoon."* → *"I finished."* → *"What's left?"*
4. Telegram: *"How is the afternoon going?"*
