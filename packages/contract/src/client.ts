/**
 * Typed HTTP client for the Relay backend. Used by BOTH the Telegram agent and
 * the Alexa skill, so neither hand-writes fetch calls or response parsing.
 *
 * Every method validates the response against the contract schema and throws
 * `RelayApiError` on any non-2xx, network failure, or schema mismatch. Callers
 * must catch it and produce the visible failure message the handoff requires
 * ("nothing was added", "let me try again") — never fabricate state.
 */
import {
  API_KEY_HEADER,
  CompleteTaskResponseSchema,
  CreateTasksResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ListTasksResponseSchema,
  NextTaskResponseSchema,
  ROUTES,
  StatusResponseSchema,
  type CompleteTaskResponse,
  type CreateTasksResponse,
  type ErrorCode,
  type HealthResponse,
  type ListTasksResponse,
  type NewTask,
  type NextTaskResponse,
  type StatusResponse,
} from "./index.js";
import type { ZodType } from "zod";

export class RelayApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the backend was unreachable / timed out */
    public readonly status: number,
    /** contract error code when the backend answered with one; "NETWORK" otherwise */
    public readonly code: ErrorCode | "NETWORK" | "BAD_RESPONSE",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "RelayApiError";
  }
  /** true when the backend could not be reached at all — show the retry message */
  get isUnreachable(): boolean {
    return this.code === "NETWORK";
  }
}

export interface RelayClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** default 5000 ms — Alexa gives you ~8 s total, keep this short */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class RelayClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RelayClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey || undefined;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Build from RELAY_API_URL / RELAY_API_KEY env vars. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): RelayClient {
    const baseUrl = env.RELAY_API_URL;
    if (!baseUrl) throw new Error("RELAY_API_URL is not set");
    return new RelayClient({ baseUrl, apiKey: env.RELAY_API_KEY });
  }

  health(): Promise<HealthResponse> {
    return this.request("GET", ROUTES.health, undefined, HealthResponseSchema);
  }

  createTasks(tasks: NewTask[]): Promise<CreateTasksResponse> {
    return this.request("POST", ROUTES.tasksBatch, { tasks }, CreateTasksResponseSchema);
  }

  listTasks(): Promise<ListTasksResponse> {
    return this.request("GET", ROUTES.tasks, undefined, ListTasksResponseSchema);
  }

  nextTask(): Promise<NextTaskResponse> {
    return this.request("GET", ROUTES.tasksNext, undefined, NextTaskResponseSchema);
  }

  completeTask(id: string): Promise<CompleteTaskResponse> {
    return this.request("POST", ROUTES.taskComplete(id), undefined, CompleteTaskResponseSchema);
  }

  /** "I'm done" with no explicit task: completes the current next task. Throws ROUTINE_COMPLETE / ROUTINE_EMPTY (409). */
  completeNextTask(): Promise<CompleteTaskResponse> {
    return this.request("POST", ROUTES.tasksNextComplete, undefined, CompleteTaskResponseSchema);
  }

  status(): Promise<StatusResponse> {
    return this.request("GET", ROUTES.status, undefined, StatusResponseSchema);
  }

  /** Demo helper. Wipes all tasks. */
  async reset(): Promise<void> {
    await this.request("POST", ROUTES.reset, undefined, null);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    schema: ZodType<T> | null,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.apiKey) headers[API_KEY_HEADER] = this.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new RelayApiError(`Backend unreachable: ${(err as Error).message}`, 0, "NETWORK");
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new RelayApiError(`Non-JSON response (${res.status})`, res.status, "BAD_RESPONSE", text);
    }

    if (!res.ok) {
      const parsed = ErrorResponseSchema.safeParse(json);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new RelayApiError(message, res.status, code, details);
      }
      throw new RelayApiError(`HTTP ${res.status}`, res.status, "BAD_RESPONSE", json);
    }

    if (schema === null) return undefined as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new RelayApiError("Response did not match contract", res.status, "BAD_RESPONSE", parsed.error.flatten());
    }
    return parsed.data;
  }
}
