/**
 * Executable contract. Runs the typed client against an app instance and
 * asserts every status code / body shape the channels rely on.
 *
 *   npm run contract:test                       # against the in-memory mock
 *   RELAY_API_URL=http://localhost:3000 npm run contract:test   # against the real backend
 *
 * The backend is "done" for P0 when this passes against it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp, DEMO_TASKS } from "./mock-server.js";
import { RelayClient, RelayApiError } from "./client.js";

async function getClient(): Promise<{ client: RelayClient; close: () => void }> {
  if (process.env.RELAY_API_URL) {
    return { client: RelayClient.fromEnv(), close: () => {} };
  }
  const server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  return { client: new RelayClient({ baseUrl: `http://127.0.0.1:${port}` }), close: () => server.close() };
}

test("contract: full Telegram -> Alexa -> Telegram loop", async () => {
  const { client, close } = await getClient();
  try {
    const health = await client.health();
    assert.equal(health.ok, true);

    await client.reset();
    let status = await client.status();
    assert.deepEqual([status.total, status.allDone], [0, false]);

    // Alexa launches before the parent planned anything
    const empty = await client.nextTask();
    assert.equal(empty.task, null);
    assert.equal(empty.remaining, 0);
    await assert.rejects(client.completeNextTask(), (e: RelayApiError) => e.status === 409 && e.code === "ROUTINE_EMPTY");

    // Scene 1: parent confirms 3 tasks
    const created = await client.createTasks(DEMO_TASKS);
    assert.equal(created.tasks.length, 3);
    assert.deepEqual(created.tasks.map((t) => t.order), [1, 2, 3]);
    assert.equal(created.tasks[2].durationMinutes, 20);
    assert.equal(created.tasks[0].durationMinutes, null);
    assert.ok(created.tasks.every((t) => t.status === "PENDING" && t.completedAt === null));

    // Scene 2: child
    const next = await client.nextTask();
    assert.equal(next.task?.title, "Math homework");
    assert.equal(next.remaining, 3);

    const done = await client.completeNextTask();
    assert.equal(done.task.title, "Math homework");
    assert.equal(done.alreadyCompleted, false);
    assert.equal(done.next?.title, "Tidy room");
    assert.equal(done.remaining, 2);

    // completing by id is idempotent
    const again = await client.completeTask(done.task.id);
    assert.equal(again.alreadyCompleted, true);
    assert.equal(again.remaining, 2);

    // Scene 3: parent asks
    status = await client.status();
    assert.equal(status.total, 3);
    assert.equal(status.completedCount, 1);
    assert.equal(status.pendingCount, 2);
    assert.equal(status.next?.title, "Tidy room");
    assert.deepEqual(status.pending.map((t) => t.title), ["Tidy room", "Practice guitar"]);
    assert.equal(status.allDone, false);

    // finish the routine
    await client.completeNextTask();
    const last = await client.completeNextTask();
    assert.equal(last.next, null);
    assert.equal(last.remaining, 0);
    status = await client.status();
    assert.equal(status.allDone, true);
    await assert.rejects(client.completeNextTask(), (e: RelayApiError) => e.status === 409 && e.code === "ROUTINE_COMPLETE");

    // errors
    await assert.rejects(client.completeTask("does-not-exist"), (e: RelayApiError) => e.status === 404 && e.code === "TASK_NOT_FOUND");
    await assert.rejects(client.createTasks([]), (e: RelayApiError) => e.status === 400 && e.code === "VALIDATION_ERROR");
    await assert.rejects(
      client.createTasks([{ title: "x", category: "NOPE" as never }]),
      (e: RelayApiError) => e.status === 400 && e.code === "VALIDATION_ERROR",
    );
    await client.reset();
  } finally {
    close();
  }
});

test("client: unreachable backend surfaces as NETWORK error, never as fake state", async () => {
  const client = new RelayClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 1000 });
  await assert.rejects(client.status(), (e: RelayApiError) => e.isUnreachable && e.status === 0);
});
