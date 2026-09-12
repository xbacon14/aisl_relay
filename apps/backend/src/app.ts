import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import {
  API_KEY_HEADER,
  CONTRACT_VERSION,
  CreateTasksRequestSchema,
  ROUTES,
  type ErrorCode,
  type NewTask,
  type StatusResponse,
  type Task,
} from "@relay/contract";

type CompleteResult = { task: Task; alreadyCompleted: boolean };

export type AsyncTaskStore = {
  create(tasks: NewTask[]): Promise<Task[]>;
  list(): Promise<Task[]>;
  next(): Promise<Task | null>;
  pendingCount(): Promise<number>;
  find(id: string): Promise<Task | null>;
  complete(id: string): Promise<CompleteResult | null>;
  status(): Promise<StatusResponse>;
  reset(): Promise<void>;
};

function sendError(res: Response, status: number, code: ErrorCode, message: string, details?: unknown): void {
  res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function createPostgresApp(store: AsyncTaskStore, apiKey?: string) {
  const app = express();
  app.use(express.json());

  if (apiKey) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === ROUTES.health) return next();
      if (req.header(API_KEY_HEADER) !== apiKey) {
        return sendError(res, 401, "UNAUTHORIZED", "Missing or invalid X-Relay-Key");
      }
      next();
    });
  }

  app.get(ROUTES.health, (_req, res) => {
    res.json({ ok: true, contractVersion: CONTRACT_VERSION, store: "postgres" });
  });

  app.post(
    ROUTES.tasksBatch,
    asyncHandler(async (req, res) => {
      const parsed = CreateTasksRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid tasks payload", parsed.error.flatten());
      }
      res.status(201).json({ tasks: await store.create(parsed.data.tasks) });
    }),
  );

  app.get(
    ROUTES.tasks,
    asyncHandler(async (_req, res) => {
      res.json({ tasks: await store.list() });
    }),
  );

  // Register /tasks/next before /tasks/:id/complete so "next" is never treated as an id.
  app.get(
    ROUTES.tasksNext,
    asyncHandler(async (_req, res) => {
      const [task, remaining] = await Promise.all([store.next(), store.pendingCount()]);
      res.json({ task, remaining });
    }),
  );

  app.post(
    ROUTES.tasksNextComplete,
    asyncHandler(async (_req, res) => {
      if ((await store.list()).length === 0) {
        return sendError(res, 409, "ROUTINE_EMPTY", "There are no tasks for this afternoon yet");
      }
      const nextTask = await store.next();
      if (!nextTask) return sendError(res, 409, "ROUTINE_COMPLETE", "Every task is already completed");
      const result = await store.complete(nextTask.id);
      if (!result) throw new Error("Pending task disappeared before completion");
      const [next, remaining] = await Promise.all([store.next(), store.pendingCount()]);
      res.json({ ...result, next, remaining });
    }),
  );

  app.post(
    "/api/tasks/:id/complete",
    asyncHandler(async (req, res) => {
      const result = await store.complete(req.params.id);
      if (!result) return sendError(res, 404, "TASK_NOT_FOUND", `No task with id ${req.params.id}`);
      const [next, remaining] = await Promise.all([store.next(), store.pendingCount()]);
      res.json({ ...result, next, remaining });
    }),
  );

  app.get(
    ROUTES.status,
    asyncHandler(async (_req, res) => {
      res.json(await store.status());
    }),
  );

  app.post(
    ROUTES.reset,
    asyncHandler(async (_req, res) => {
      await store.reset();
      res.status(204).end();
    }),
  );

  app.use((_req, res) => sendError(res, 404, "VALIDATION_ERROR", "Unknown route"));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof SyntaxError) return sendError(res, 400, "VALIDATION_ERROR", "Malformed JSON body");
    console.error("[relay backend] unexpected request error");
    sendError(res, 500, "INTERNAL_ERROR", "Unexpected error");
  });

  return app;
}
