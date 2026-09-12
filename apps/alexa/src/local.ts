// P2 owner starts here. See apps/alexa/README.md for the scope.
import { RelayClient } from "@relay/contract/client";

const relay = RelayClient.fromEnv();
const next = await relay.nextTask();
console.log("[relay alexa] next task from backend:", next);
console.log("TODO: ASK SDK handlers (Launch, NextTask, Done, WhatsLeft) + local express endpoint");
