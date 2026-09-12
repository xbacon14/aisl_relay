/**
 * Alexa handlers for Relay ("my afternoon"). Hosting-agnostic: used by
 * lambda.ts (real skill), local.ts (express endpoint) and smoke.ts (tests).
 *
 * Rule: every fact the child hears comes from a backend response. On any
 * RelayApiError we say "I can't check right now", never fabricate state.
 */
import { SkillBuilders, type HandlerInput, type RequestHandler, type ErrorHandler } from "ask-sdk-core";
import type { Response } from "ask-sdk-model";
import { RelayClient, RelayApiError } from "@relay/contract/client";
import type { Task } from "@relay/contract";

export const SPEECH = {
  retry: "I can't check right now. Let's try again in a moment.",
  empty: "Nothing is planned yet. Ask a grown-up to add the afternoon.",
  allDone: "You're all done for today.",
  help: "You can say: what's next, I'm done, or what's left.",
  bye: "Bye! See you later.",
  reprompt: "Say what's next, I'm done, or what's left.",
};

let relay: RelayClient | undefined;
export function getRelay(): RelayClient {
  if (!relay) relay = RelayClient.fromEnv();
  return relay;
}
/** for tests / local wiring */
export function setRelay(client: RelayClient): void {
  relay = client;
}

const isIntent = (input: HandlerInput, ...names: string[]) =>
  input.requestEnvelope.request.type === "IntentRequest" &&
  names.includes(input.requestEnvelope.request.intent.name);

const things = (n: number) => (n === 1 ? "one thing" : `${numberWord(n)} things`);
function numberWord(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[n] ?? String(n);
}
function withDuration(t: Task): string {
  return t.durationMinutes ? `${t.title} for ${t.durationMinutes} minutes` : t.title;
}
function joinTitles(tasks: Task[]): string {
  const parts = tasks.map(withDuration);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function speak(input: HandlerInput, text: string, endSession = false): Response {
  const b = input.responseBuilder.speak(text);
  if (endSession) b.withShouldEndSession(true);
  else b.reprompt(SPEECH.reprompt);
  return b.getResponse();
}

function speechForError(err: unknown): string {
  if (err instanceof RelayApiError) {
    if (err.code === "ROUTINE_COMPLETE") return SPEECH.allDone;
    if (err.code === "ROUTINE_EMPTY") return SPEECH.empty;
  }
  console.error("[relay alexa] backend error", err);
  return SPEECH.retry;
}

export const LaunchRequestHandler: RequestHandler = {
  canHandle: (input) => input.requestEnvelope.request.type === "LaunchRequest",
  async handle(input) {
    try {
      const { task, remaining } = await getRelay().nextTask();
      if (!task) {
        // remaining 0: either nothing exists or all done. Ask status to tell them apart.
        const status = await getRelay().status();
        return speak(input, status.total === 0 ? SPEECH.empty : SPEECH.allDone, true);
      }
      return speak(input, `You have ${things(remaining)} to do this afternoon. Let's start with ${withDuration(task)}.`);
    } catch (err) {
      return speak(input, speechForError(err), true);
    }
  },
};

export const NextTaskIntentHandler: RequestHandler = {
  canHandle: (input) => isIntent(input, "NextTaskIntent"),
  async handle(input) {
    try {
      const { task } = await getRelay().nextTask();
      if (!task) {
        const status = await getRelay().status();
        return speak(input, status.total === 0 ? SPEECH.empty : SPEECH.allDone, true);
      }
      return speak(input, `Next, ${withDuration(task)}.`);
    } catch (err) {
      return speak(input, speechForError(err), true);
    }
  },
};

export const DoneIntentHandler: RequestHandler = {
  canHandle: (input) => isIntent(input, "DoneIntent"),
  async handle(input) {
    try {
      const { next, remaining } = await getRelay().completeNextTask();
      if (!next || remaining === 0) return speak(input, `Done. ${SPEECH.allDone}`, true);
      return speak(input, `Done. ${numberWord(remaining)} left. Next, ${withDuration(next)}.`);
    } catch (err) {
      return speak(input, speechForError(err), true);
    }
  },
};

export const WhatsLeftIntentHandler: RequestHandler = {
  canHandle: (input) => isIntent(input, "WhatsLeftIntent"),
  async handle(input) {
    try {
      const status = await getRelay().status();
      if (status.total === 0) return speak(input, SPEECH.empty, true);
      if (status.allDone) return speak(input, SPEECH.allDone, true);
      return speak(input, `${joinTitles(status.pending)}.`);
    } catch (err) {
      return speak(input, speechForError(err), true);
    }
  },
};

export const HelpIntentHandler: RequestHandler = {
  canHandle: (input) => isIntent(input, "AMAZON.HelpIntent"),
  handle: (input) => speak(input, SPEECH.help),
};

export const StopIntentHandler: RequestHandler = {
  canHandle: (input) => isIntent(input, "AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"),
  handle: (input) => speak(input, SPEECH.bye, true),
};

export const FallbackIntentHandler: RequestHandler = {
  canHandle: (input) => isIntent(input, "AMAZON.FallbackIntent"),
  handle: (input) => speak(input, `Sorry, I didn't get that. ${SPEECH.help}`),
};

export const SessionEndedRequestHandler: RequestHandler = {
  canHandle: (input) => input.requestEnvelope.request.type === "SessionEndedRequest",
  handle: (input) => input.responseBuilder.getResponse(),
};

export const GenericErrorHandler: ErrorHandler = {
  canHandle: () => true,
  handle(input, error) {
    console.error("[relay alexa] unhandled error", error);
    return speak(input, SPEECH.retry, true);
  },
};

/** The assembled skill. `.lambda()` for AWS, `.create()` for local/express. */
export const skillBuilder = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    NextTaskIntentHandler,
    DoneIntentHandler,
    WhatsLeftIntentHandler,
    HelpIntentHandler,
    StopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(GenericErrorHandler)
  .withCustomUserAgent("relay/alexa");
