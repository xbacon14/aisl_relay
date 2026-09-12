/**
 * @relay/contract — the single source of truth for what crosses the wire
 * between the backend, the Telegram agent and the Alexa skill.
 *
 * RULES
 *  - Change this file first, then the implementations. Never the other way around.
 *  - Additive changes (new optional field) are fine at any time.
 *  - Breaking changes need a message in the team channel + bump CONTRACT_VERSION.
 *  - Runtime validation lives here (zod) so the backend validates requests and
 *    the channels validate responses with the exact same schema.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export const CATEGORIES = ["HOUSEHOLD", "SCHOOL", "EXTRACURRICULAR", "OTHER"] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const STATUSES = ["PENDING", "COMPLETED"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  category: CategorySchema,
  /** null when the adult did not mention a duration */
  durationMinutes: z.number().int().positive().nullable(),
  status: StatusSchema,
  /** 1-based position inside today's routine; stable once created */
  order: z.number().int().positive(),
  /** ISO-8601 */
  createdAt: z.string(),
  /** ISO-8601, null while PENDING */
  completedAt: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

/** What the Telegram agent sends after the adult confirms. No id/status/order: the backend assigns them. */
export const NewTaskSchema = z.object({
  title: z.string().min(1).max(120),
  category: CategorySchema.default("OTHER"),
  durationMinutes: z.number().int().positive().nullable().optional(),
});
export type NewTask = z.infer<typeof NewTaskSchema>;

// ---------------------------------------------------------------------------
// Requests / responses per endpoint
// ---------------------------------------------------------------------------

/** POST /api/tasks/batch */
export const CreateTasksRequestSchema = z.object({
  tasks: z.array(NewTaskSchema).min(1).max(20),
});
export type CreateTasksRequest = z.infer<typeof CreateTasksRequestSchema>;

export const CreateTasksResponseSchema = z.object({
  tasks: z.array(TaskSchema),
});
export type CreateTasksResponse = z.infer<typeof CreateTasksResponseSchema>;

/** GET /api/tasks */
export const ListTasksResponseSchema = z.object({
  /** always sorted by `order` ascending, PENDING and COMPLETED mixed */
  tasks: z.array(TaskSchema),
});
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

/** GET /api/tasks/next — 200 even when nothing is pending (task: null) */
export const NextTaskResponseSchema = z.object({
  task: TaskSchema.nullable(),
  /** number of PENDING tasks, including `task` */
  remaining: z.number().int().nonnegative(),
});
export type NextTaskResponse = z.infer<typeof NextTaskResponseSchema>;

/** POST /api/tasks/:id/complete  and  POST /api/tasks/next/complete */
export const CompleteTaskResponseSchema = z.object({
  /** the task that is now COMPLETED */
  task: TaskSchema,
  /** true if it was already COMPLETED before this call (idempotent) */
  alreadyCompleted: z.boolean(),
  /** the new next PENDING task, or null when the routine is finished */
  next: TaskSchema.nullable(),
  /** PENDING tasks left after this completion */
  remaining: z.number().int().nonnegative(),
});
export type CompleteTaskResponse = z.infer<typeof CompleteTaskResponseSchema>;

/** GET /api/status */
export const StatusResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  completed: z.array(TaskSchema),
  pending: z.array(TaskSchema),
  next: TaskSchema.nullable(),
  /** total > 0 && pendingCount === 0 */
  allDone: z.boolean(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

/** GET /api/health */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.string(),
  /** "memory" for the mock, "postgres" for the real thing */
  store: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** POST /api/reset — demo helper, wipes every task. Returns 204. */

// ---------------------------------------------------------------------------
// Errors — every non-2xx body has this shape
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  "VALIDATION_ERROR",   // 400  body/params did not match the schema
  "UNAUTHORIZED",       // 401  missing/wrong X-Relay-Key
  "TASK_NOT_FOUND",     // 404  unknown task id
  "ROUTINE_COMPLETE",   // 409  POST /tasks/next/complete with nothing pending
  "ROUTINE_EMPTY",      // 409  POST /tasks/next/complete with zero tasks at all
  "INTERNAL_ERROR",     // 500
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Routes — use these constants instead of string literals
// ---------------------------------------------------------------------------

export const ROUTES = {
  health: "/api/health",
  tasks: "/api/tasks",
  tasksBatch: "/api/tasks/batch",
  tasksNext: "/api/tasks/next",
  tasksNextComplete: "/api/tasks/next/complete",
  taskComplete: (id: string) => `/api/tasks/${encodeURIComponent(id)}/complete`,
  status: "/api/status",
  reset: "/api/reset",
} as const;

/** Header carrying the shared secret. Optional when the backend has no RELAY_API_KEY set. */
export const API_KEY_HEADER = "x-relay-key";

// ---------------------------------------------------------------------------
// LLM command shapes (Telegram side). The backend never sees these; they are
// here so the agent boundary is explicit and reviewable in one place.
// ---------------------------------------------------------------------------

export const AgentCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("PROPOSE_TASKS"),
    tasks: z.array(NewTaskSchema).min(1).max(20),
  }),
  z.object({ action: z.literal("GET_STATUS") }),
  z.object({ action: z.literal("COMPLETE_TASK"), taskId: z.string().min(1) }),
  z.object({
    action: z.literal("CLARIFY"),
    /** question to send back to the adult when the parse is not confident */
    question: z.string().min(1),
  }),
]);
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
