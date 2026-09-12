// P0 owner starts here. Until Postgres is wired, this serves the in-memory
// contract implementation so the repo boots end to end from minute one.
// Replace `InMemoryTaskStore` with a Postgres-backed store exposing the same
// methods; keep `createApp` semantics identical (or copy it here and adapt).
import { createApp } from "@relay/contract/mock";
import { InMemoryTaskStore } from "@relay/contract/store";

const port = Number(process.env.PORT ?? 3000);
createApp(new InMemoryTaskStore(), process.env.RELAY_API_KEY || undefined).listen(port, () => {
  console.log(`[relay backend] listening on http://localhost:${port} (store: memory — TODO postgres)`);
});
