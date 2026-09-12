# AGENTS.md — rules for any coding agent working in this repo

## Rule zero: we are on a hackathon clock

This project is judged on **one live end-to-end demo**, not on code quality. Every decision optimizes for
*"does this increase the probability that Telegram → backend → Alexa → backend → Telegram works reliably in the next few hours?"*

Therefore:

- **Ship the working slice. Do not refactor, do not polish, do not generalize.** If it runs the demo path, it is done.
- **No code review, no purism, no bikeshedding.** Duplication, `any`, long functions, inline SQL, hardcoded demo values: all acceptable. Fix them only if they break the demo.
- **Make the decision yourself and move on.** Do not stop to ask the human which library, pattern, naming or structure to use. Pick the most boring, most common option and continue. Only ask when a decision is impossible to reverse or needs a credential/account only a human has.
- **Do not add scope.** The non-goals in `docs/handoff.md` are law: no auth beyond `X-Relay-Key`, no multi-household, no web UI, no recurrence, no rewards, no observability stack, no test suites beyond the contract test.
- **Do not invent state.** The one non-negotiable engineering rule: the LLM interprets, the backend decides. Every fact a user hears comes from a backend response.
- **Prefer copy-paste over abstraction.** Three similar handlers beat one clever generic one when the clock is running.
- **Fail visibly, never plausibly.** On any backend error say "nothing was added" / "try again", never "done".

## Contract

`CONTRACT.md` and `packages/contract/src/index.ts` are frozen for v1. Build against `npm run mock`. The contract test (`npm run contract:test`) is the only test that matters.

## Ownership

| Dir | Owner | Others may |
| --- | --- | --- |
| `apps/backend` | backend person | read |
| `apps/telegram` | telegram person | read |
| `apps/alexa` | alexa person | read |
| `packages/contract` | shared | change only with a message to the team + `npm run verify` green |

## Stack (fixed, do not revisit)

Node ≥ 20 · TypeScript · ESM · Express 4 · PostgreSQL (`pg`) · grammY · ASK SDK v2 · OpenRouter (OpenAI-compatible chat completions, JSON output) · npm workspaces · `tsx` for dev.

## Verify

```bash
npm run verify     # typecheck + contract test. Must be green before pushing to main.
```

That is the whole quality gate.
