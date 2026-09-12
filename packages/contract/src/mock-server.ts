/**
 * Contract mock: a real Express server implementing every endpoint in memory.
 *
 *   npm run mock            # from repo root, listens on :3000
 *   MOCK_PORT=4000 npm run mock
 *   MOCK_SEED=1 npm run mock   # starts with the 3 demo tasks already created
 *
 * Telegram and Alexa build against this on day one. When the real backend is
 * up, only RELAY_API_URL changes. The backend team can also reuse
 * `createApp()` as a reference implementation of status codes and bodies.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import {
  API_KEY_HEADER,
  CONTRACT_VERSION,
  CreateTasksRequestSchema,
  ROUTES,
  type ErrorCode,
} from "./index.js";
import { InMemoryTaskStore } from "./store.js";

function sendError(res: Response, status: number, code: ErrorCode, message: string, details?: unknown) {
  res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

export function createApp(store = new InMemoryTaskStore(), apiKey?: string) {
  const app = express();
  app.use(express.json());

  if (apiKey) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === ROUTES.health) return next();
      if (req.header(API_KEY_HEADER) !== apiKey) return sendError(res, 401, "UNAUTHORIZED", "Missing or invalid X-Relay-Key");
      next();
    });
  }

  app.get(ROUTES.health, (_req, res) => {
    res.json({ ok: true, contractVersion: CONTRACT_VERSION, store: "memory" });
  });

  app.post(ROUTES.tasksBatch, (req, res) => {
    const parsed = CreateTasksRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "VALIDATION_ERROR", "Invalid tasks payload", parsed.error.flatten());
    res.status(201).json({ tasks: store.create(parsed.data.tasks) });
  });

  app.get(ROUTES.tasks, (_req, res) => {
    res.json({ tasks: store.list() });
  });

  // NOTE: /tasks/next must be registered before /tasks/:id/complete so "next" is not read as an id.
  app.get(ROUTES.tasksNext, (_req, res) => {
    res.json({ task: store.next(), remaining: store.pendingCount() });
  });

  app.post(ROUTES.tasksNextComplete, (_req, res) => {
    if (store.list().length === 0) return sendError(res, 409, "ROUTINE_EMPTY", "There are no tasks for this afternoon yet");
    const next = store.next();
    if (!next) return sendError(res, 409, "ROUTINE_COMPLETE", "Every task is already completed");
    const result = store.complete(next.id)!;
    res.json({ ...result, next: store.next(), remaining: store.pendingCount() });
  });

  app.post("/api/tasks/:id/complete", (req, res) => {
    const result = store.complete(req.params.id);
    if (!result) return sendError(res, 404, "TASK_NOT_FOUND", `No task with id ${req.params.id}`);
    res.json({ ...result, next: store.next(), remaining: store.pendingCount() });
  });

  app.get(ROUTES.status, (_req, res) => {
    res.json(store.status());
  });

  app.post(ROUTES.reset, (_req, res) => {
    store.reset();
    res.status(204).end();
  });

  app.use((_req, res) => sendError(res, 404, "VALIDATION_ERROR", "Unknown route"));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) return sendError(res, 400, "VALIDATION_ERROR", "Malformed JSON body");
    console.error(err);
    sendError(res, 500, "INTERNAL_ERROR", "Unexpected error");
  });

  return app;
}

export const DEMO_TASKS = [
  { title: "Math homework", category: "SCHOOL" as const },
  { title: "Tidy room", category: "HOUSEHOLD" as const },
  { title: "Practice guitar", category: "EXTRACURRICULAR" as const, durationMinutes: 20 },
];

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isMain) {
  const store = new InMemoryTaskStore();
  if (process.env.MOCK_SEED) store.create(DEMO_TASKS);
  const port = Number(process.env.MOCK_PORT ?? process.env.PORT ?? 3000);
  createApp(store, process.env.RELAY_API_KEY || undefined).listen(port, () => {
    console.log(`[relay mock] contract v${CONTRACT_VERSION} listening on http://localhost:${port}${process.env.MOCK_SEED ? " (seeded)" : ""}`);
  });
}
