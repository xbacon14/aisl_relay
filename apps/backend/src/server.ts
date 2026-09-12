import type { Server } from "node:http";
import { Pool } from "pg";
import { createPostgresApp } from "./app.js";
import { runMigrations } from "./migrate.js";
import { PostgresTaskStore } from "./postgres-task-store.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("[relay backend] startup failed: DATABASE_URL is required");
  process.exitCode = 1;
} else {
  await start(databaseUrl);
}

async function start(connectionString: string): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("[relay backend] startup failed: PORT must be an integer from 1 to 65535");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  pool.on("error", () => {
    console.error("[relay backend] PostgreSQL pool connection failed");
  });
  let server: Server | undefined;

  try {
    await pool.query("SELECT 1");
    await runMigrations(pool);
    const app = createPostgresApp(new PostgresTaskStore(pool), process.env.RELAY_API_KEY || undefined);
    server = app.listen(port, host, () => {
      console.log(`[relay backend] listening on http://${host}:${port} (store: postgres)`);
    });
  } catch {
    console.error("[relay backend] startup failed: PostgreSQL is unavailable or migration failed");
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[relay backend] received ${signal}, shutting down`);

    const forceExit = setTimeout(() => {
      console.error("[relay backend] graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server?.close((serverError) => {
      void pool
        .end()
        .then(() => {
          clearTimeout(forceExit);
          process.exit(serverError ? 1 : 0);
        })
        .catch(() => process.exit(1));
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
