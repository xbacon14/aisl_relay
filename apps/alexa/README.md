# @relay/alexa — P2, the child's channel

**Scope:** Alexa skill, invocation *"my afternoon"*. Deterministic intents backed by `RelayClient`. No LLM.

| Intent | Backend call | Speech |
| --- | --- | --- |
| LaunchRequest | `GET /api/tasks/next` (+ `/api/status` when null) | "You have three things to do this afternoon. Let's start with math homework." / "You're all done for today." / "Nothing is planned yet…" |
| NextTaskIntent ("what's next") | `GET /api/tasks/next` | "Next, tidy your room." |
| DoneIntent ("I finished", "I'm done") | `POST /api/tasks/next/complete` | "Done. two left. Next, tidy your room." / "Done. You're all done for today." |
| WhatsLeftIntent | `GET /api/status` | "tidy your room and practice guitar for 20 minutes." |
| any `RelayApiError` | — | "I can't check right now. Let's try again in a moment." |

## Files

| File | What |
| --- | --- |
| `src/handlers.ts` | all intent handlers + `skillBuilder`. Hosting-agnostic. |
| `src/lambda.ts` | AWS Lambda entrypoint (`exports.handler`) |
| `src/local.ts` | express `POST /alexa` for tunnel-based testing (`npm run dev:alexa`) |
| `src/smoke.ts` | full voice flow against mock/real backend (`npm run smoke -w @relay/alexa`) |
| `skill-package/` | `skill.json` manifest + `interactionModels/custom/en-US.json` (invocation, intents, utterances) |

## Verify without a device

```bash
npm run mock                                              # terminal 1
RELAY_API_URL=http://localhost:3000 npm run smoke -w @relay/alexa   # terminal 2
```
Prints every step (`✓`/`✗`) and exits 1 on mismatch. Point `RELAY_API_URL` at the deployed backend to smoke the real thing.

## Deploy (needs an Amazon developer account — pending `ask` login)

**Option A — Alexa Developer Console + AWS Lambda (no ASK CLI needed):**
1. `npm run bundle -w @relay/alexa` → `apps/alexa/dist/relay-alexa-lambda.zip` (single CJS file, deps inlined).
2. AWS Lambda → create function, Node 20, upload zip, handler `index.handler`, env `RELAY_API_URL`, `RELAY_API_KEY`. Timeout 8 s.
3. Add trigger "Alexa Skills Kit" (skill id verification can be off for the hackathon).
4. developer.amazon.com/alexa → Create skill "My Afternoon", Custom, "Provision your own". In *JSON Editor* paste `skill-package/interactionModels/custom/en-US.json`, build model. Endpoint → Lambda ARN.
5. Test tab → "open my afternoon". Echo Dot on the same Amazon account picks it up automatically (dev mode).

**Option B — ASK CLI once authenticated:** `ask init` in `apps/alexa`, point `skill-package/skill.json` endpoint at the Lambda ARN, `ask deploy`.

Keep every backend call under ~5 s (`RelayClient` default timeout). Alexa cuts the response at 8 s.

## Env
`RELAY_API_URL`, `RELAY_API_KEY`. Local endpoint: `ALEXA_PORT` (default 3978).
