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
| `src/lambda.ts` | AWS Lambda / Alexa-hosted entrypoint (`exports.handler`) |
| `src/config.ts` | build-time baked `RELAY_API_URL`/`RELAY_API_KEY` (Alexa-hosted has no env vars) |
| `scripts/build-hosted.sh` | `npm run hosted` — builds the Alexa-hosted repo layout into `dist/hosted/` |
| `src/local.ts` | express `POST /alexa` for tunnel-based testing (`npm run dev:alexa`) |
| `src/smoke.ts` | full voice flow against mock/real backend (`npm run smoke -w @relay/alexa`) |
| `skill-package/` | `skill.json` manifest + `interactionModels/custom/en-US.json` (invocation, intents, utterances) |

## Verify without a device

```bash
npm run mock                                              # terminal 1
RELAY_API_URL=http://localhost:3000 npm run smoke -w @relay/alexa   # terminal 2
```
Prints every step (`✓`/`✗`) and exits 1 on mismatch. Point `RELAY_API_URL` at the deployed backend to smoke the real thing.

## Deploy

### Option A — Alexa-hosted (recommended for the demo: free, no AWS account)

Amazon runs the Lambda, S3 and DynamoDB for you. Needs only an Amazon developer account.

1. **Create the skill.** developer.amazon.com/alexa/console/ask → *Create Skill* → name "My Afternoon", locale en-US, model **Custom**, method **Alexa-hosted (Node.js)**. Wait for provisioning.
2. **Get the repo.** Skill → *Code* tab → copy the git URL, or in the *Code* tab use "Download the skill package". With the ASK CLI: `ask init --hosted-skill-id <id>` clones it.
3. **Build our payload.**
   ```bash
   RELAY_API_URL=https://<public-backend> RELAY_API_KEY=<key> npm run hosted -w @relay/alexa
   ```
   → `dist/hosted/` containing `lambda/index.js` (single CJS bundle, zero deps) + `lambda/package.json` + `skill-package/`.
4. **Push.** Copy `dist/hosted/lambda/` and `dist/hosted/skill-package/` over the clone's, then `git add -A && git commit -m "relay" && git push`. The push *is* the deploy; the console shows build status.
5. **Build the model.** *Build* tab → the pushed `interactionModels/custom/en-US.json` is already there → *Build Model*.
6. **Test.** *Test* tab → enable Development → "open my afternoon". Any Echo on the same Amazon account picks it up automatically.

**Gotchas:**
- Hosted skills have **no env-var editor**, so `RELAY_API_URL`/`RELAY_API_KEY` are baked into the bundle at step 3 (`src/config.ts` + esbuild `--define`). Backend URL changed? Re-run step 3 and push again.
- The backend must be **publicly reachable over HTTPS** — `localhost` will not work. Tunnel it (ngrok/cloudflared) or deploy it.
- The hosted manifest must not pin a Lambda ARN; the build script strips it (`apis.custom: {}`).
- Logs: *Code* tab → CloudWatch link, or `ask smapi` — our handlers log `[relay alexa]` on every backend error.

### Option B — Your own AWS Lambda

1. `npm run bundle -w @relay/alexa` → `dist/relay-alexa-lambda.zip`.
2. AWS Lambda → create function, Node 20, upload zip, handler `index.handler`, env `RELAY_API_URL`, `RELAY_API_KEY`. Timeout 8 s.
3. Add trigger "Alexa Skills Kit".
4. Create the skill with **"Provision your own"**, paste the interaction model in the JSON Editor, build, point Endpoint at the Lambda ARN.

Keep every backend call under ~5 s (`RelayClient` default timeout). Alexa cuts the response at 8 s.


## Env
`RELAY_API_URL`, `RELAY_API_KEY`. Local endpoint: `ALEXA_PORT` (default 3978).

## LIVE SETUP (what actually works — 2026-09-12)

Skill **My Afternoon** exists in Javier's Amazon dev account: `amzn1.ask.skill.1e15ef82-5fa9-4eca-a2b3-3ba2db0684f6`, en-US, enabled for Development.
Endpoint = ngrok → `local.ts` on this laptop (`sslCertificateType: Wildcard`, path `/alexa`). Alexa-hosted failed to provision; Cloudflare tunnel and SMAPI simulator both misbehave — ignore them, the console Test tab and real Echo work.

Start order (3 terminals):
```bash
RELAY_API_URL=<italo-backend or http://localhost:3000 mock> RELAY_API_KEY=<key> npm run dev:alexa   # port 3978
ngrok http --url=bodacious-deftly-passover.ngrok-free.dev 3978   # if the URL changes: update endpoint in console Build → Endpoint
```
Echo Dot must be set to **English (US)** (Alexa app → Devices → Echo → Language). Then: "Alexa, open my afternoon" → "I'm done" → "what's left".
