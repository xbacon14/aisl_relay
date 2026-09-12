/**
 * Covers the parts of the Telegram agent that decide whether something gets
 * written to the backend: LLM output parsing and confirmation matching.
 *
 *   npm run test -w @relay/telegram
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { StatusResponse, Task } from "@relay/contract";
import {
  extractJsonObject,
  formatStatus,
  isAffirmative,
  isNegative,
  matchPendingTasks,
  parseAgentCommand,
} from "./parse.js";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    category: "OTHER",
    durationMinutes: null,
    status: "PENDING",
    order: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...partial,
  };
}

test("extractJsonObject unwraps markdown fences and prose", () => {
  assert.equal(extractJsonObject('```json\n{"action":"GET_STATUS"}\n```'), '{"action":"GET_STATUS"}');
  assert.equal(extractJsonObject('```\n{"action":"GET_STATUS"}\n```'), '{"action":"GET_STATUS"}');
  assert.equal(extractJsonObject('Sure! Here you go: {"action":"GET_STATUS"} Hope that helps.'), '{"action":"GET_STATUS"}');
  assert.equal(extractJsonObject('{"a":{"b":1}}'), '{"a":{"b":1}}');
  assert.equal(extractJsonObject('{"title":"a } brace in a string"}'), '{"title":"a } brace in a string"}');
  assert.equal(extractJsonObject("no json at all"), null);
});

test("parseAgentCommand accepts the canonical shapes", () => {
  assert.deepEqual(parseAgentCommand('{"action":"GET_STATUS"}'), { action: "GET_STATUS" });
  assert.deepEqual(parseAgentCommand('{"action":"CLARIFY","question":"Which one?"}'), {
    action: "CLARIFY",
    question: "Which one?",
  });
});

test("parseAgentCommand survives fenced output from free providers", () => {
  const command = parseAgentCommand('```json\n{"action":"PROPOSE_TASKS","tasks":[{"title":"Math homework","category":"school"}]}\n```');
  assert.equal(command.action, "PROPOSE_TASKS");
  assert.deepEqual(command.action === "PROPOSE_TASKS" ? command.tasks : null, [
    { title: "Math homework", category: "SCHOOL" },
  ]);
});

test("parseAgentCommand normalizes invented action names", () => {
  assert.deepEqual(parseAgentCommand('{"action":"check_status"}'), { action: "GET_STATUS" });
  const command = parseAgentCommand('{"action":"CREATE_PLAN","tasks":[{"title":"Tidy room","category":"HOUSEHOLD"}]}');
  assert.equal(command.action, "PROPOSE_TASKS");
});

test("parseAgentCommand carries a task title into taskId", () => {
  const command = parseAgentCommand('{"action":"COMPLETE_TASK","title":"Math homework"}');
  assert.deepEqual(command, { action: "COMPLETE_TASK", taskId: "Math homework" });
  assert.deepEqual(parseAgentCommand('{"action":"MARK_DONE"}'), { action: "COMPLETE_TASK", taskId: "next" });
});

test("parseAgentCommand rejects anything the frozen schema does not accept", () => {
  assert.throws(() => parseAgentCommand("not json"));
  assert.throws(() => parseAgentCommand('{"action":"DELETE_EVERYTHING"}'));
  assert.throws(() => parseAgentCommand('{"action":"PROPOSE_TASKS","tasks":[]}'));
  assert.throws(() => parseAgentCommand('{"action":"PROPOSE_TASKS","tasks":[{"category":"SCHOOL"}]}'));
});

test("parseAgentCommand clamps oversized proposals into the contract limits", () => {
  const tasks = Array.from({ length: 25 }, (_, i) => ({ title: "x".repeat(200) + i, category: "OTHER" }));
  const command = parseAgentCommand(JSON.stringify({ action: "PROPOSE_TASKS", tasks }));
  assert.equal(command.action, "PROPOSE_TASKS");
  if (command.action !== "PROPOSE_TASKS") return;
  assert.equal(command.tasks.length, 20);
  assert.ok(command.tasks.every((t) => t.title.length <= 120));
});

test("isAffirmative accepts the natural variants a parent actually types", () => {
  for (const yes of ["yes", "Yes", "yes please", "sí", "si", "sí, dale", "ok", "okay", "dale", "confirmo", "perfecto", "Add them"]) {
    assert.ok(isAffirmative(yes), `expected affirmative: ${yes}`);
  }
  for (const notYes of ["no", "not yet", "cancel", "add math homework too", "you should wait"]) {
    assert.ok(!isAffirmative(notYes), `expected NOT affirmative: ${notYes}`);
  }
});

test("isNegative recognizes explicit rejection only", () => {
  for (const no of ["no", "No", "nope", "cancel", "cancela", "mejor no", "olvídalo", "not yet"]) {
    assert.ok(isNegative(no), `expected negative: ${no}`);
  }
  assert.ok(!isNegative("yes"));
  assert.ok(!isNegative("also add guitar"));
});

test("matchPendingTasks resolves a spoken title to a pending task", () => {
  const tasks = [
    task({ id: "1", title: "Math homework", status: "COMPLETED", order: 1 }),
    task({ id: "2", title: "Tidy room", order: 2 }),
    task({ id: "3", title: "Practice guitar", order: 3 }),
  ];
  assert.deepEqual(matchPendingTasks(tasks, "Tidy room").map((t) => t.id), ["2"]);
  assert.deepEqual(matchPendingTasks(tasks, "guitar").map((t) => t.id), ["3"]);
  assert.deepEqual(matchPendingTasks(tasks, "she tidied her room").map((t) => t.id), ["2"]);
  // Already completed tasks are never matched, so nothing is completed twice by accident.
  assert.deepEqual(matchPendingTasks(tasks, "Math homework"), []);
  assert.deepEqual(matchPendingTasks(tasks, "next"), []);
  assert.deepEqual(matchPendingTasks(tasks, "swimming"), []);
});

test("formatStatus reports only what the backend returned", () => {
  const empty: StatusResponse = { total: 0, completedCount: 0, pendingCount: 0, completed: [], pending: [], next: null, allDone: false };
  assert.equal(formatStatus(empty), "Nothing is planned yet.");

  const done = task({ id: "1", title: "Math homework", status: "COMPLETED" });
  const pending = task({ id: "2", title: "Tidy room", order: 2 });
  assert.equal(
    formatStatus({ total: 2, completedCount: 1, pendingCount: 1, completed: [done], pending: [pending], next: pending, allDone: false }),
    "1 of 2 tasks completed. Done: Math homework. Still pending: Tidy room.",
  );
  assert.equal(
    formatStatus({ total: 1, completedCount: 1, pendingCount: 0, completed: [done], pending: [], next: null, allDone: true }),
    "Everything is done — 1 of 1 tasks completed.",
  );
});
