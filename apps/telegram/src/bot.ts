import { Bot, InlineKeyboard } from "grammy";
import {
  AgentCommandSchema,
  type NewTask,
  type StatusResponse,
  type Task,
} from "@relay/contract";
import { RelayApiError, RelayClient } from "@relay/contract/client";

const token = requiredEnv("TELEGRAM_BOT_TOKEN");
const openRouterApiKey = requiredEnv("OPENROUTER_API_KEY");
const model = requiredEnv("MODEL");
const relay = RelayClient.fromEnv();
const bot = new Bot(token);

// Telegram chat ids are strings so group chats and private chats use the same key.
const pendingProposals = new Map<string, NewTask[]>();

const SYSTEM_PROMPT = `You are the intent extractor for a household afternoon planner.
Return exactly one JSON object and no markdown. It must be one of:
{"action":"PROPOSE_TASKS","tasks":[{"title":"...","category":"HOUSEHOLD"|"SCHOOL"|"EXTRACURRICULAR"|"OTHER","durationMinutes":positive integer optional}]}
{"action":"GET_STATUS"}
{"action":"COMPLETE_TASK","taskId":"opaque backend task id"}
{"action":"CLARIFY","question":"a short question for the adult"}

Only propose concrete tasks the adult explicitly asks to add. Use a concise title, preserve a stated duration, and choose OTHER if no category fits. For questions about progress, completed work, remaining work, or what is next, return GET_STATUS. Never claim a task was created or completed. If unsure, return CLARIFY. Do not invent a task id.`;

bot.command("start", async (ctx) => {
  await ctx.reply("Tell me what needs to get done this afternoon, and I’ll prepare it for your confirmation.");
});

bot.command("cancel", async (ctx) => {
  const removed = pendingProposals.delete(String(ctx.chat.id));
  await ctx.reply(removed ? "That proposal was discarded." : "There isn’t a proposal waiting for confirmation.");
});

bot.on("callback_query:data", async (ctx) => {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "I can’t find this chat." });
    return;
  }

  if (ctx.callbackQuery.data === "proposal:cancel") {
    pendingProposals.delete(chatId);
    await ctx.answerCallbackQuery({ text: "Discarded" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("That proposal was discarded.");
    return;
  }

  if (ctx.callbackQuery.data === "proposal:confirm") {
    await ctx.answerCallbackQuery();
    await confirmProposal(ctx, chatId);
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  const chatId = String(ctx.chat.id);
  if (pendingProposals.has(chatId)) {
    if (isAffirmative(text)) {
      await confirmProposal(ctx, chatId);
    } else {
      pendingProposals.delete(chatId);
      await ctx.reply("I discarded that proposal. Send the afternoon tasks when you’re ready.");
    }
    return;
  }

  let command;
  try {
    command = await extractCommand(text);
  } catch (error) {
    console.error("[relay telegram] LLM extraction failed", error);
    await ctx.reply("I couldn’t understand that safely. Please say the tasks you’d like to add.");
    return;
  }

  switch (command.action) {
    case "PROPOSE_TASKS":
      pendingProposals.set(chatId, command.tasks);
      await ctx.reply(
        `${formatProposal(command.tasks)}\n\nAdd these to this afternoon?`,
        { reply_markup: new InlineKeyboard().text("Yes, add them", "proposal:confirm").text("Cancel", "proposal:cancel") },
      );
      return;
    case "GET_STATUS":
      await sendStatus(ctx);
      return;
    case "COMPLETE_TASK":
      await completeTask(ctx, command.taskId);
      return;
    case "CLARIFY":
      await ctx.reply(command.question);
      return;
  }
});

bot.catch((error) => {
  console.error("[relay telegram] bot error", error.error);
});

console.log("[relay telegram] starting long polling");
bot.start({ drop_pending_updates: true });

async function confirmProposal(ctx: { reply: (text: string, options?: object) => Promise<unknown> }, chatId: string): Promise<void> {
  const tasks = pendingProposals.get(chatId);
  if (!tasks) {
    await ctx.reply("That proposal is no longer available. Please send the tasks again.");
    return;
  }

  // Remove it before the network call: a duplicate tap/message cannot create a second batch.
  pendingProposals.delete(chatId);
  try {
    const result = await relay.createTasks(tasks);
    await ctx.reply(`Added to this afternoon:\n${formatCreatedTasks(result.tasks)}`);
  } catch (error) {
    console.error("[relay telegram] create tasks failed", error);
    await ctx.reply(createFailureMessage(error));
  }
}

async function sendStatus(ctx: { reply: (text: string, options?: object) => Promise<unknown> }): Promise<void> {
  try {
    // Every count, title and completion fact in this message comes from this response.
    const status = await relay.status();
    await ctx.reply(formatStatus(status));
  } catch (error) {
    console.error("[relay telegram] status failed", error);
    await ctx.reply("I couldn’t reach the planner. Please try again.");
  }
}

async function completeTask(ctx: { reply: (text: string, options?: object) => Promise<unknown> }, taskId: string): Promise<void> {
  try {
    const result = await relay.completeTask(taskId);
    const suffix = result.next ? ` Next: ${result.next.title}.` : " Everything is done.";
    await ctx.reply(result.alreadyCompleted ? `${result.task.title} was already done.${suffix}` : `Marked ${result.task.title} as done.${suffix}`);
  } catch (error) {
    console.error("[relay telegram] complete task failed", error);
    if (error instanceof RelayApiError && error.code === "TASK_NOT_FOUND") {
      await ctx.reply("I couldn’t find that task, so nothing was changed.");
      return;
    }
    await ctx.reply("I couldn’t reach the planner, so nothing was changed. Please try again.");
  }
}

async function extractCommand(text: string) {
  let payload = await requestCompletion(text, true);
  let content = getMessageContent(payload);

  // Not every OpenRouter provider (especially free fallbacks) supports the
  // OpenAI response_format option. The prompt still requires JSON and Zod is
  // still the gate before anything is acted on.
  if (!content) {
    payload = await requestCompletion(text, false);
    content = getMessageContent(payload);
  }
  if (!content) throw new Error(`OpenRouter returned no choices: ${openRouterError(payload)}`);

  return parseAgentCommand(content);
}

async function requestCompletion(text: string, structuredOutput: boolean): Promise<unknown> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openRouterApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...(structuredOutput ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
  return response.json();
}

function parseAgentCommand(content: string) {
  const raw: unknown = JSON.parse(content);
  const parsed = AgentCommandSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Some OpenRouter models invent friendly action names despite the prompt.
  // Normalize only those aliases, then use the frozen schema as the actual gate.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const command = { ...(raw as Record<string, unknown>) };
    const action = typeof command.action === "string" ? command.action.toUpperCase() : "";
    const aliases: Record<string, string> = {
      ADD_TASKS: "PROPOSE_TASKS",
      CREATE_TASKS: "PROPOSE_TASKS",
      CREATE_ROUTINE: "PROPOSE_TASKS",
      PROPOSE_TASK: "PROPOSE_TASKS",
      STATUS: "GET_STATUS",
      CHECK_STATUS: "GET_STATUS",
      GET_PROGRESS: "GET_STATUS",
    };
    command.action = aliases[action] ?? action;

    if (Array.isArray(command.tasks)) {
      // A task array is unambiguously a proposal in the v1 command language.
      // Models often label this CREATE_PLAN / ADD_TASK instead of our exact verb.
      command.action = "PROPOSE_TASKS";
      command.tasks = command.tasks.map((task) => {
        if (!task || typeof task !== "object" || Array.isArray(task)) return task;
        const normalizedTask = { ...(task as Record<string, unknown>) };
        if (typeof normalizedTask.category === "string") normalizedTask.category = normalizedTask.category.toUpperCase();
        return normalizedTask;
      });
    }

    const normalized = AgentCommandSchema.safeParse(command);
    if (normalized.success) return normalized.data;
  }

  const receivedAction = raw && typeof raw === "object" && !Array.isArray(raw)
    ? String((raw as Record<string, unknown>).action ?? "missing")
    : "invalid JSON shape";
  throw new Error(`Invalid agent command (action: ${receivedAction}): ${parsed.error.message}`);
}

function getMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  return typeof content === "string" ? content : null;
}

function openRouterError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid response";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "empty response";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "provider error";
}

function formatProposal(tasks: NewTask[]): string {
  return `I understood:\n${tasks.map((task, index) => `${index + 1}. ${task.title} — ${categoryLabel(task.category)}${task.durationMinutes ? `, ${task.durationMinutes} min` : ""}`).join("\n")}`;
}

function formatCreatedTasks(tasks: Task[]): string {
  return tasks.map((task, index) => `${index + 1}. ${task.title}${task.durationMinutes ? ` (${task.durationMinutes} min)` : ""}`).join("\n");
}

function formatStatus(status: StatusResponse): string {
  if (status.total === 0) return "Nothing is planned yet.";
  if (status.allDone) return `Everything is done — ${status.completedCount} of ${status.total} tasks completed.`;

  const done = status.completed.length ? ` Done: ${taskTitles(status.completed)}.` : "";
  const pending = status.pending.length ? ` Still pending: ${taskTitles(status.pending)}.` : "";
  return `${status.completedCount} of ${status.total} tasks completed.${done}${pending}`;
}

function taskTitles(tasks: Task[]): string {
  return tasks.map((task) => task.title).join(", ");
}

function categoryLabel(category: NewTask["category"]): string {
  return category.toLowerCase();
}

function isAffirmative(text: string): boolean {
  return /^(yes|y|yeah|yep|sure|si|sí|dale|confirm|confirmar|ok|okay)$/i.test(text.trim());
}

function createFailureMessage(error: unknown): string {
  if (error instanceof RelayApiError && error.code === "ROUTINE_COMPLETE") return "Everything is already done. Nothing was added.";
  return "I couldn’t reach the planner, nothing was added. Please try again.";
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
