import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

const migrationUrl = new URL("../migrations/001_create_tasks.sql", import.meta.url);

export async function runMigrations(pool: Pool): Promise<void> {
  const sql = await readFile(migrationUrl, "utf8");
  await pool.query(sql);
}
