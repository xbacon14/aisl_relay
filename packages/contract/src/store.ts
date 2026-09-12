/**
 * In-memory implementation of the domain rules. Used by the mock server, and
 * the backend may copy its logic 1:1 onto Postgres — the rules must not diverge.
 */
import { randomUUID } from "node:crypto";
import type { NewTask, StatusResponse, Task } from "./index.js";

export class InMemoryTaskStore {
  private tasks: Task[] = [];

  create(input: NewTask[]): Task[] {
    const base = this.tasks.length;
    const now = new Date().toISOString();
    const created = input.map<Task>((t, i) => ({
      id: randomUUID(),
      title: t.title.trim(),
      category: t.category ?? "OTHER",
      durationMinutes: t.durationMinutes ?? null,
      status: "PENDING",
      order: base + i + 1,
      createdAt: now,
      completedAt: null,
    }));
    this.tasks.push(...created);
    return created;
  }

  list(): Task[] {
    return [...this.tasks].sort((a, b) => a.order - b.order);
  }

  /** First PENDING task by order. */
  next(): Task | null {
    return this.list().find((t) => t.status === "PENDING") ?? null;
  }

  pendingCount(): number {
    return this.tasks.filter((t) => t.status === "PENDING").length;
  }

  find(id: string): Task | null {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  /** Idempotent. Returns null when id is unknown. */
  complete(id: string): { task: Task; alreadyCompleted: boolean } | null {
    const task = this.find(id);
    if (!task) return null;
    if (task.status === "COMPLETED") return { task, alreadyCompleted: true };
    task.status = "COMPLETED";
    task.completedAt = new Date().toISOString();
    return { task, alreadyCompleted: false };
  }

  status(): StatusResponse {
    const all = this.list();
    const completed = all.filter((t) => t.status === "COMPLETED");
    const pending = all.filter((t) => t.status === "PENDING");
    return {
      total: all.length,
      completedCount: completed.length,
      pendingCount: pending.length,
      completed,
      pending,
      next: pending[0] ?? null,
      allDone: all.length > 0 && pending.length === 0,
    };
  }

  reset(): void {
    this.tasks = [];
  }
}
