/**
 * Pure helpers for the Telegram agent: prompt, LLM output parsing, confirmation
 * matching and message formatting. No network, no env, no bot — so bot.test.ts
 * can import them without starting long polling.
 */
import { AgentCommandSchema, type NewTask, type StatusResponse, type Task } from "@relay/contract";

export const SYSTEM_PROMPT = `You are the intent extractor for a household afternoon planner.
Return exactly one JSON object and no markdown. It must be one of:
{"action":"PROPOSE_TASKS","tasks":[{"title":"...","category":"HOUSEHOLD"|"SCHOOL"|"EXTRACURRICULAR"|"OTHER","durationMinutes":positive integer optional}]}
{"action":"GET_STATUS"}
{"action":"COMPLETE_TASK","title":"the task as the adult named it, or \\"next\\" when no task is named"}
{"action":"CLARIFY","question":"a short question for the adult"}

Only propose concrete tasks the adult explicitly asks to add. Use a concise title, preserve a stated duration, and choose OTHER if no category fits. For questions about progress, completed work, remaining work, or what is next, return GET_STATUS. For "she finished X" / "X is done" / "he's done", return COMPLETE_TASK with the task title the adult used, or "next" if they did not name one. Never claim a task was created or completed. If unsure, return CLARIFY. Never invent an id.`;

/**
 * Free OpenRouter providers ignore response_format and answer with ```json
 * fences or a prose preamble. Pull the first balanced JSON object out of the
 * text instead of trusting the whole body to be JSON.
 */
export function extractJsonObject(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : content).trim();

  const start = body.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  return null;
}

const ACTION_ALIASES: Record<string, string> = {
  ADD_TASKS: "PROPOSE_TASKS",
  CREATE_TASKS: "PROPOSE_TASKS",
  CREATE_ROUTINE: "PROPOSE_TASKS",
  CREATE_PLAN: "PROPOSE_TASKS",
  ADD_TASK: "PROPOSE_TASKS",
  PROPOSE_TASK: "PROPOSE_TASKS",
  STATUS: "GET_STATUS",
  CHECK_STATUS: "GET_STATUS",
  GET_PROGRESS: "GET_STATUS",
  COMPLETE: "COMPLETE_TASK",
  MARK_DONE: "COMPLETE_TASK",
  COMPLETE_TASKS: "COMPLETE_TASK",
  ASK: "CLARIFY",
  QUESTION: "CLARIFY",
};

export function parseAgentCommand(content: string) {
  const jsonText = extractJsonObject(content);
  if (!jsonText) throw new Error(`No JSON object in LLM output: ${content.slice(0, 200)}`);

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`LLM output is not valid JSON (${(error as Error).message}): ${jsonText.slice(0, 200)}`);
  }

  const parsed = AgentCommandSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Models invent friendly action names and extra fields despite the prompt.
  // Normalize only shape, then use the frozen schema as the actual gate.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const command = { ...(raw as Record<string, unknown>) };
    const action = typeof command.action === "string" ? command.action.trim().toUpperCase() : "";
    command.action = ACTION_ALIASES[action] ?? action;

    if (Array.isArray(command.tasks)) {
      // A task array is unambiguously a proposal in the v1 command language.
      command.action = "PROPOSE_TASKS";
      command.tasks = command.tasks.slice(0, 20).map((task) => {
        if (!task || typeof task !== "object" || Array.isArray(task)) return task;
        const t = { ...(task as Record<string, unknown>) };
        if (typeof t.category === "string") t.category = t.category.trim().toUpperCase();
        if (typeof t.title === "string") t.title = t.title.trim().slice(0, 120);
        if (t.durationMinutes === undefined && typeof t.duration === "number") t.durationMinutes = t.duration;
        if (typeof t.durationMinutes === "number") t.durationMinutes = Math.round(t.durationMinutes) || null;
        return t;
      });
    }

    // The schema is frozen on `taskId`, but the prompt asks for a human title
    // (the model never sees a backend id). Carry it in taskId and resolve it
    // against the real task list before anything is completed.
    if (command.action === "COMPLETE_TASK" && typeof command.taskId !== "string") {
      const named = [command.title, command.task, command.name].find((v) => typeof v === "string" && v.trim());
      command.taskId = typeof named === "string" ? named.trim() : "next";
    }

    const normalized = AgentCommandSchema.safeParse(command);
    if (normalized.success) return normalized.data;
    throw new Error(`Invalid agent command (action: ${String(command.action) || "missing"}): ${normalized.error.message}`);
  }

  throw new Error(`Invalid agent command (invalid JSON shape): ${parsed.error.message}`);
}

// ---------------------------------------------------------------------------
// Confirmation matching — a missed "yes" on stage means re-dictating everything,
// so accept the natural variants and treat anything unrecognized as "ask again"
// rather than as a rejection.
// ---------------------------------------------------------------------------

// Matched against accent-folded text, so "sí" and "si" are the same input.
const AFFIRMATIVE =
  /^(y|yes|yeah|yep|yup|sure|ok|okay|okey|k|si|claro|dale|listo|perfecto|correcto|exacto|adelante|hazlo|confirm|confirmo|confirmar|confirmado|go ahead|add (them|these|it)|agrega(las|los)?|anade(las|los)?)\b/;
const NEGATIVE = /^(n|no|nope|nah|not|cancel|cancela|cancelar|cancelalo|descarta|descartar|olvidalo|mejor no|para|stop|nevermind|never mind|nel)\b/;

function normalize(text: string): string {
  return foldCase(text).replace(/^[\s"'\u00a1\u00bf,.-]+/, "");
}

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(normalize(text));
}

export function isNegative(text: string): boolean {
  return NEGATIVE.test(normalize(text));
}

/** PENDING tasks whose title matches what the adult said. */
export function matchPendingTasks(tasks: Task[], query: string): Task[] {
  const q = foldCase(query);
  if (!q || q === "next" || q === "siguiente") return [];
  const pending = tasks.filter((t) => t.status === "PENDING");

  const exact = pending.filter((t) => foldCase(t.title) === q);
  if (exact.length) return exact;

  const substring = pending.filter((t) => foldCase(t.title).includes(q) || q.includes(foldCase(t.title)));
  if (substring.length) return substring;

  // Last resort: any pending task sharing a word longer than 3 chars.
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  return words.length ? pending.filter((t) => words.some((w) => foldCase(t.title).includes(w))) : [];
}

function foldCase(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// ---------------------------------------------------------------------------
// Formatting — every number and title below comes from a backend response.
// ---------------------------------------------------------------------------

export function formatProposal(tasks: NewTask[]): string {
  return `I understood:\n${tasks
    .map((task, i) => `${i + 1}. ${task.title} — ${task.category.toLowerCase()}${task.durationMinutes ? `, ${task.durationMinutes} min` : ""}`)
    .join("\n")}`;
}

export function formatCreatedTasks(tasks: Task[]): string {
  return tasks.map((task, i) => `${i + 1}. ${task.title}${task.durationMinutes ? ` (${task.durationMinutes} min)` : ""}`).join("\n");
}

export function formatStatus(status: StatusResponse): string {
  if (status.total === 0) return "Nothing is planned yet.";
  if (status.allDone) return `Everything is done — ${status.completedCount} of ${status.total} tasks completed.`;

  const done = status.completed.length ? ` Done: ${taskTitles(status.completed)}.` : "";
  const pending = status.pending.length ? ` Still pending: ${taskTitles(status.pending)}.` : "";
  return `${status.completedCount} of ${status.total} tasks completed.${done}${pending}`;
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "Nothing is planned yet.";
  return tasks.map((t) => `${t.order}. ${t.status === "COMPLETED" ? "✅" : "⬜"} ${t.title}${t.durationMinutes ? ` (${t.durationMinutes} min)` : ""}`).join("\n");
}

export function taskTitles(tasks: Task[]): string {
  return tasks.map((task) => task.title).join(", ");
}
