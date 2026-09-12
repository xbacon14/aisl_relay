// AWS Lambda / Alexa-hosted entrypoint. Env: RELAY_API_URL, RELAY_API_KEY.
import { skillBuilder } from "./handlers.js";
export const handler = skillBuilder.lambda();
