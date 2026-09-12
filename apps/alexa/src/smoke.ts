/**
 * End-to-end smoke of the voice flow against a running backend (mock or real):
 *   npm run mock &  RELAY_API_URL=http://localhost:3000 npm run smoke -w @relay/alexa
 * Prints what Alexa would say at each step and exits non-zero on mismatch.
 */
import { RelayClient } from "@relay/contract/client";
import { skillBuilder, setRelay, SPEECH } from "./handlers.js";
import { launch, intent } from "./requests.js";

const relay = RelayClient.fromEnv();
setRelay(relay);
const skill = skillBuilder.create();

let failures = 0;
async function say(label: string, env: ReturnType<typeof launch>, expect?: RegExp) {
  const out = await skill.invoke(env);
  const ssml = (out.response.outputSpeech as { ssml?: string } | undefined)?.ssml ?? "";
  const text = ssml.replace(/<\/?speak>/g, "");
  const ok = !expect || expect.test(text);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(28)} → "${text}"`);
}

await relay.reset();
await say("launch (empty)", launch(), new RegExp(SPEECH.empty));
await say("done (empty)", intent("DoneIntent"), new RegExp(SPEECH.empty));

await relay.createTasks([
  { title: "math homework", category: "SCHOOL", durationMinutes: null },
  { title: "tidy your room", category: "HOUSEHOLD", durationMinutes: null },
  { title: "practice guitar", category: "EXTRACURRICULAR", durationMinutes: 20 },
]);

await say("launch", launch(), /You have three things to do this afternoon\. Let's start with math homework\./);
await say("what's next", intent("NextTaskIntent"), /Next, math homework\./);
await say("I'm done", intent("DoneIntent"), /Done\. two left\. Next, tidy your room\./);
await say("what's left", intent("WhatsLeftIntent"), /tidy your room and practice guitar for 20 minutes\./);
await say("I'm done", intent("DoneIntent"), /Done\. one left\. Next, practice guitar for 20 minutes\./);
await say("I'm done", intent("DoneIntent"), new RegExp(`Done\\. ${SPEECH.allDone.replace(/[.']/g, "\\$&")}`));
await say("I'm done (complete)", intent("DoneIntent"), new RegExp(SPEECH.allDone.replace(/[.']/g, "\\$&")));
await say("launch (complete)", launch(), new RegExp(SPEECH.allDone.replace(/[.']/g, "\\$&")));
await say("what's left (complete)", intent("WhatsLeftIntent"), new RegExp(SPEECH.allDone.replace(/[.']/g, "\\$&")));
await say("help", intent("AMAZON.HelpIntent"), new RegExp(SPEECH.help.replace(/[.'?]/g, "\\$&")));
await say("stop", intent("AMAZON.StopIntent"), new RegExp(SPEECH.bye.replace(/[.!]/g, "\\$&")));

// unreachable backend → retry message, never "done"
setRelay(new RelayClient({ baseUrl: "http://127.0.0.1:9", timeoutMs: 1000 }));
await say("done (backend down)", intent("DoneIntent"), new RegExp(SPEECH.retry.replace(/[.']/g, "\\$&")));

console.log(failures ? `\n${failures} FAILED` : "\nall good");
process.exit(failures ? 1 : 0);
