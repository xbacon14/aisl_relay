// Minimal Alexa request envelopes for local/smoke use. Not sent by real devices.
import type { RequestEnvelope } from "ask-sdk-model";

function envelope(request: RequestEnvelope["request"]): RequestEnvelope {
  return {
    version: "1.0",
    session: {
      new: request.type === "LaunchRequest",
      sessionId: "amzn1.echo-api.session.local",
      application: { applicationId: "amzn1.ask.skill.local" },
      user: { userId: "amzn1.ask.account.local" },
    },
    context: {
      System: {
        application: { applicationId: "amzn1.ask.skill.local" },
        user: { userId: "amzn1.ask.account.local" },
        apiEndpoint: "https://api.amazonalexa.com",
      },
    },
    request,
  } as RequestEnvelope;
}

const now = () => new Date().toISOString();

export const launch = (): RequestEnvelope =>
  envelope({ type: "LaunchRequest", requestId: "req.launch", timestamp: now(), locale: "en-US" });

export const intent = (name: string): RequestEnvelope =>
  envelope({
    type: "IntentRequest",
    requestId: `req.${name}`,
    timestamp: now(),
    locale: "en-US",
    dialogState: "COMPLETED",
    intent: { name, confirmationStatus: "NONE" },
  });
