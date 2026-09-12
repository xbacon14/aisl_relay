# @relay/alexa — P2, the child's channel

**Scope:** Alexa skill, invocation *"my afternoon"*. Deterministic intents backed by `RelayClient`. No LLM.

| Intent | Backend call | Speech |
| --- | --- | --- |
| LaunchRequest | `GET /api/tasks/next` | "You have {remaining} things to do this afternoon. Let's start with {task.title}." / "You're all done for today." / "Nothing is planned yet." |
| NextTaskIntent ("what's next") | `GET /api/tasks/next` | "Next, {task.title}." |
| DoneIntent ("I finished", "I'm done") | `POST /api/tasks/next/complete` | "Done. {remaining} left. Next, {next.title}." / "Done. You're all done for today." |
| WhatsLeftIntent | `GET /api/status` | joins `pending` titles, with duration when present |
| any `RelayApiError` | — | "I can't check right now. Let's try again in a moment." |

**Done when:** launch → "I finished" → "what's left?" works on a real Echo Dot, first against the mock, then against the deployed backend.

## Hosting
Alexa needs an HTTPS endpoint. Fastest options: Alexa-hosted skill (Node, paste the built handler) or an AWS Lambda. Keep every backend call under ~5 s (`RelayClient` timeout default) — Alexa cuts the response at 8 s.

Keep `src/handlers.ts` free of ASK-hosting specifics so the same code runs in `src/local.ts` for quick iteration.

## Env
`RELAY_API_URL`, `RELAY_API_KEY`.
