// P1 owner starts here. See apps/telegram/README.md for the scope.
import { RelayClient } from "@relay/contract/client";

const relay = RelayClient.fromEnv();
const health = await relay.health();
console.log("[relay telegram] backend reachable:", health);
console.log("TODO: grammY bot + LLM extraction + confirmation flow");
