import { Bot, InlineKeyboard, type Context } from "grammy";
import type { NewTask } from "@relay/contract";
import { RelayApiError, RelayClient } from "@relay/contract/client";
import {
  SYSTEM_PROMPT,
  formatCreatedTasks,
  formatProposal,
  formatStatus,
  formatTaskList,
  isAffirmative,
  isNegative,
  matchPendingTasks,
  parseAgentCommand,
} from "./parse.js";

const token = requiredEnv("TELEGRAM_BOT_TOKEN");
const openRouterApiKey = requiredEnv("OPENROUTER_API_KEY");
const model = requiredEnv("MODEL");
const relay = RelayClient.fromEnv();
const bot = new Bot(token);

const LLM_TIMEOUT_MS = 12_000;
const PROPOSAL_TTL_MS = 10 * 60_000;

interface PendingProposal {
  tasks: NewTask[];
  createdAt: number;
}

// Telegram chat ids are strings so group chats and private chats use the same key.
const pendingProposals = new Map<string, PendingProposal>();
// Chats with an LLM extraction in flight: one message at a time per chat, so a
// second message cannot overwrite the proposal the adult is about to confirm.
const busyChats = new Set<string>();

// ---------------------------------------------------------------------------
// Deterministic commands. These never touch the LLM, so the demo still works
// when OpenRouter is slow or down.
// ---------------------------------------------------------------------------

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Tell me what needs to get done this afternoon, and I’ll prepare it for your confirmation.\n\n" +
      "/status — how the afternoon is going\n/tasks — the full list\n/next — what’s next\n/done — complete the next task\n/reset — clear the afternoon\n/cancel — discard a pending proposal",
  );
});

bot.command("cancel", async (ctx) => {
  const removed = pendingProposals.delete(String(ctx.chat.id));
  await ctx.reply(removed ? "That proposal was discarded." : "There isn’t a proposal waiting for confirmation.");
});

bot.command("status", (ctx) => sendStatus(ctx));

bot.command("tasks", async (ctx) => {
  await withBackend(ctx, "I couldn’t reach the planner. Please try again.", async () => {
    const { tasks } = await relay.listTasks();
    await ctx.reply(formatTaskList(tasks));
  });
});

bot.command("next", async (ctx) => {
  await withBackend(ctx, "I couldn’t reach the planner. Please try again.", async () => {
    const { task, remaining } = await relay.nextTask();
    await ctx.reply(task ? `Next: ${task.title}. ${remaining} left.` : "Everything is done.");
  });
});

bot.command("done", async (ctx) => {
  await completeNext(ctx);
});

bot.command("reset", async (ctx) => {
  pendingProposals.delete(String(ctx.chat.id));
  await withBackend(ctx, "I couldn’t reach the planner, so nothing was cleared.", async () => {
    await relay.reset();
    await ctx.reply("The afternoon is cleared.");
  });
});

bot.command("health", async (ctx) => {
  try {
    const health = await relay.health();
    await ctx.reply(`Planner OK — contract v${health.contractVersion}, store ${health.store}.`);
  } catch (error) {
    console.error("[relay telegram] health failed", error);
    await ctx.reply(`I couldn’t reach the planner: ${error instanceof RelayApiError ? error.message : "unknown error"}`);
  }
});

// ---------------------------------------------------------------------------
// Inline confirmation buttons
// ---------------------------------------------------------------------------

bot.on("callback_query:data", async (ctx) => {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "I can’t find this chat." });
    return;
  }

  if (ctx.callbackQuery.data === "proposal:cancel") {
    pendingProposals.delete(chatId);
    await ctx.answerCallbackQuery({ text: "Discarded" });
    await clearKeyboard(ctx);
    await ctx.reply("That proposal was discarded.");
    return;
  }

  if (ctx.callbackQuery.data === "proposal:confirm") {
    await ctx.answerCallbackQuery();
    await clearKeyboard(ctx);
    await confirmProposal(ctx, chatId);
  }
});

// ---------------------------------------------------------------------------
// Free text
// ---------------------------------------------------------------------------

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  const chatId = String(ctx.chat.id);

  const pending = getProposal(chatId);
  if (pending) {
    if (isNegative(text)) {
      pendingProposals.delete(chatId);
      await ctx.reply("I discarded that proposal. Send the afternoon tasks when you’re ready.");
    } else if (isConfirmation(text)) {
      await confirmProposal(ctx, chatId);
    } else {
      // Never destroy a proposal on an unrecognized reply: re-dictating the
      // tasks on stage is the worst possible failure mode.
      await ctx.reply("I still have that proposal waiting. Reply “yes” to add it, “no” to discard it, or /cancel.");
    }
    return;
  }

  if (busyChats.has(chatId)) {
    await ctx.reply("I’m still working on your previous message — one moment.");
    return;
  }

  busyChats.add(chatId);
  let command;
  try {
    await typing(ctx);
    command = await extractCommand(text);
  } catch (error) {
    console.error("[relay telegram] LLM extraction failed", error);
    await ctx.reply("I couldn’t understand that safely. Please say the tasks you’d like to add, or use /status.");
    return;
  } finally {
    busyChats.delete(chatId);
  }

  switch (command.action) {
    case "PROPOSE_TASKS":
      pendingProposals.set(chatId, { tasks: command.tasks, createdAt: Date.now() });
      await ctx.reply(`${formatProposal(command.tasks)}\n\nAdd these to this afternoon?`, {
        reply_markup: new InlineKeyboard().text("Yes, add them", "proposal:confirm").text("Cancel", "proposal:cancel"),
      });
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

bot.catch(async (err) => {
  console.error("[relay telegram] bot error", err.error);
  try {
    await err.ctx.reply("Something went wrong on my side. Nothing was changed — please try again.");
  } catch (replyError) {
    console.error("[relay telegram] could not report the error", replyError);
  }
});

console.log("[relay telegram] starting long polling");
bot.start({ drop_pending_updates: true });

// Surface a bad RELAY_API_URL at boot instead of mid-demo.
relay
  .health()
  .then((h) => console.log(`[relay telegram] backend OK — contract v${h.contractVersion}, store ${h.store}`))
  .catch((error) => console.error("[relay telegram] BACKEND UNREACHABLE AT STARTUP", error));

// ---------------------------------------------------------------------------
// Backend actions. Every fact in these replies comes from the response.
// ---------------------------------------------------------------------------

async function confirmProposal(ctx: Context, chatId: string): Promise<void> {
  const pending = getProposal(chatId);
  if (!pending) {
    await ctx.reply("That proposal is no longer available. Please send the tasks again.");
    return;
  }

  // Remove it before the network call: a duplicate tap/message cannot create a second batch.
  pendingProposals.delete(chatId);
  try {
    await typing(ctx);
    const result = await relay.createTasks(pending.tasks);
    await ctx.reply(`Added to this afternoon:\n${formatCreatedTasks(result.tasks)}`);
  } catch (error) {
    console.error("[relay telegram] create tasks failed", error);
    if (error instanceof RelayApiError && error.code === "ROUTINE_COMPLETE") {
      await ctx.reply("Everything is already done. Nothing was added.");
      return;
    }
    if (isRetryable(error)) {
      // Keep the proposal so the adult can just say "yes" again.
      pendingProposals.set(chatId, { tasks: pending.tasks, createdAt: Date.now() });
      await ctx.reply("I couldn’t reach the planner, nothing was added. Reply “yes” to try again.");
      return;
    }
    await ctx.reply("I couldn’t add those tasks, nothing was added. Please send them again.");
  }
}

async function sendStatus(ctx: Context): Promise<void> {
  await withBackend(ctx, "I couldn’t reach the planner. Please try again.", async () => {
    // Every count, title and completion fact in this message comes from this response.
    const status = await relay.status();
    await ctx.reply(formatStatus(status));
  });
}

/** Resolve what the adult named against the real task list, then complete it. */
async function completeTask(ctx: Context, named: string): Promise<void> {
  let matches;
  try {
    await typing(ctx);
    const { tasks } = await relay.listTasks();
    matches = matchPendingTasks(tasks, named);
  } catch (error) {
    console.error("[relay telegram] list tasks failed", error);
    await ctx.reply("I couldn’t reach the planner, so nothing was changed. Please try again.");
    return;
  }

  if (matches.length > 1) {
    await ctx.reply(`I found more than one match: ${matches.map((t) => t.title).join(", ")}. Which one is done?`);
    return;
  }
  if (matches.length === 0) {
    await completeNext(ctx);
    return;
  }

  await withBackend(ctx, "I couldn’t reach the planner, so nothing was changed. Please try again.", async () => {
    const result = await relay.completeTask(matches![0].id);
    await ctx.reply(completionMessage(result));
  }, (error) => (error.code === "TASK_NOT_FOUND" ? "I couldn’t find that task, so nothing was changed." : null));
}

async function completeNext(ctx: Context): Promise<void> {
  await withBackend(ctx, "I couldn’t reach the planner, so nothing was changed. Please try again.", async () => {
    const result = await relay.completeNextTask();
    await ctx.reply(completionMessage(result));
  }, (error) => {
    if (error.code === "ROUTINE_EMPTY") return "Nothing is planned yet.";
    if (error.code === "ROUTINE_COMPLETE") return "Everything is already done.";
    return null;
  });
}

function completionMessage(result: { task: { title: string }; alreadyCompleted: boolean; next: { title: string } | null }): string {
  const suffix = result.next ? ` Next: ${result.next.title}.` : " Everything is done.";
  return result.alreadyCompleted ? `${result.task.title} was already done.${suffix}` : `Marked ${result.task.title} as done.${suffix}`;
}

/** Run a backend call, mapping RelayApiError codes to the wording the contract requires. */
async function withBackend(
  ctx: Context,
  fallback: string,
  run: () => Promise<void>,
  mapError?: (error: RelayApiError) => string | null,
): Promise<void> {
  try {
    await typing(ctx);
    await run();
  } catch (error) {
    console.error("[relay telegram] backend call failed", error);
    const mapped = error instanceof RelayApiError && mapError ? mapError(error) : null;
    await ctx.reply(mapped ?? fallback);
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof RelayApiError && (error.isUnreachable || error.code === "BAD_RESPONSE" || error.status >= 500);
}

function getProposal(chatId: string): PendingProposal | undefined {
  const pending = pendingProposals.get(chatId);
  if (!pending) return undefined;
  // A proposal left over from a previous rehearsal must not be confirmable.
  if (Date.now() - pending.createdAt > PROPOSAL_TTL_MS) {
    pendingProposals.delete(chatId);
    return undefined;
  }
  return pending;
}

/**
 * A bare "yes" is a confirmation; "ok but make it 30 minutes" is not — it only
 * looks like one. Require a short reply so a correction is never mistaken for
 * consent.
 */
function isConfirmation(text: string): boolean {
  return isAffirmative(text) && text.trim().split(/\s+/).length <= 4;
}

async function typing(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithChatAction("typing");
  } catch {
    // Purely cosmetic; never let it break a real action.
  }
}

async function clearKeyboard(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (error) {
    console.error("[relay telegram] could not clear keyboard", error);
  }
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

async function extractCommand(text: string) {
  // Attempt 1: structured output. Attempt 2 drops response_format (not every
  // free provider supports it) and doubles as the retry for 429/5xx/timeouts.
  let content: string | null = null;
  let firstError: unknown = null;
  try {
    content = getMessageContent(await requestCompletion(text, true));
  } catch (error) {
    firstError = error;
  }

  if (!content) {
    await sleep(700);
    try {
      content = getMessageContent(await requestCompletion(text, false));
    } catch (error) {
      throw firstError ?? error;
    }
  }
  if (!content) throw firstError ?? new Error("OpenRouter returned no usable content");

  return parseAgentCommand(content);
}

async function requestCompletion(text: string, structuredOutput: boolean): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
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
  } catch (error) {
    throw new Error(
      (error as Error).name === "AbortError" ? `OpenRouter timed out after ${LLM_TIMEOUT_MS} ms` : `OpenRouter request failed: ${(error as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
  return response.json();
}

function getMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    console.error("[relay telegram] OpenRouter returned no choices:", openRouterError(payload));
    return null;
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

function openRouterError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid response";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "empty response";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "provider error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
