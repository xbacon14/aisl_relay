import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Category, NewTask, Status, StatusResponse, Task } from "@relay/contract";

type TaskRow = {
  id: string;
  title: string;
  category: Category;
  duration_minutes: number | null;
  status: Status;
  order: number;
  created_at: Date | string;
  completed_at: Date | string | null;
};

type CompleteResult = { task: Task; alreadyCompleted: boolean };

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    durationMinutes: row.duration_minutes,
    status: row.status,
    order: row.order,
    createdAt: toIso(row.created_at),
    completedAt: row.completed_at === null ? null : toIso(row.completed_at),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

export class PostgresTaskStore {
  constructor(private readonly pool: Pool) {}

  async create(input: NewTask[]): Promise<Task[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize all task writes while assigning stable, gap-free batch positions.
      await client.query("LOCK TABLE tasks IN SHARE ROW EXCLUSIVE MODE");
      const maxResult = await client.query<{ max_order: number }>(
        'SELECT COALESCE(MAX("order"), 0)::integer AS max_order FROM tasks',
      );
      const firstOrder = maxResult.rows[0].max_order + 1;
      const created: Task[] = [];

      for (const [index, task] of input.entries()) {
        const result = await client.query<TaskRow>(
          `INSERT INTO tasks (id, title, category, duration_minutes, status, "order")
           VALUES ($1, $2, $3, $4, 'PENDING', $5)
           RETURNING id, title, category, duration_minutes, status, "order", created_at, completed_at`,
          [
            randomUUID(),
            task.title.trim(),
            task.category ?? "OTHER",
            task.durationMinutes ?? null,
            firstOrder + index,
          ],
        );
        created.push(mapTask(result.rows[0]));
      }

      await client.query("COMMIT");
      return created;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(): Promise<Task[]> {
    const result = await this.pool.query<TaskRow>(
      `SELECT id, title, category, duration_minutes, status, "order", created_at, completed_at
       FROM tasks
       ORDER BY "order" ASC`,
    );
    return result.rows.map(mapTask);
  }

  async next(): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT id, title, category, duration_minutes, status, "order", created_at, completed_at
       FROM tasks
       WHERE status = 'PENDING'
       ORDER BY "order" ASC
       LIMIT 1`,
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  async pendingCount(): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM tasks WHERE status = 'PENDING'",
    );
    return result.rows[0].count;
  }

  async find(id: string): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT id, title, category, duration_minutes, status, "order", created_at, completed_at
       FROM tasks
       WHERE id::text = $1`,
      [id],
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  async complete(id: string): Promise<CompleteResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<TaskRow>(
        `SELECT id, title, category, duration_minutes, status, "order", created_at, completed_at
         FROM tasks
         WHERE id::text = $1
         FOR UPDATE`,
        [id],
      );
      const row = existing.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      if (row.status === "COMPLETED") {
        await client.query("COMMIT");
        return { task: mapTask(row), alreadyCompleted: true };
      }

      const updated = await client.query<TaskRow>(
        `UPDATE tasks
         SET status = 'COMPLETED', completed_at = now()
         WHERE id = $1
         RETURNING id, title, category, duration_minutes, status, "order", created_at, completed_at`,
        [row.id],
      );
      await client.query("COMMIT");
      return { task: mapTask(updated.rows[0]), alreadyCompleted: false };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async status(): Promise<StatusResponse> {
    const all = await this.list();
    const completed = all.filter((task) => task.status === "COMPLETED");
    const pending = all.filter((task) => task.status === "PENDING");
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

  async reset(): Promise<void> {
    await this.pool.query("DELETE FROM tasks");
  }
}
