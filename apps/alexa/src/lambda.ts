// AWS Lambda / Alexa-hosted entrypoint.
// Config: env RELAY_API_URL/RELAY_API_KEY, or baked in at bundle time
// (Alexa-hosted has no env vars) — see config.ts.
import { applyBakedConfig } from "./config.js";
import { skillBuilder } from "./handlers.js";

applyBakedConfig();
export const handler = skillBuilder.lambda();
