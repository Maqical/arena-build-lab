import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "@/lib/schema";

const globalForDatabase = globalThis as unknown as { arenaDatabase?: DatabaseSync };

export function databasePath(): string {
  const configured = process.env.ARENA_DB_PATH;
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(process.cwd(), "data", "arena.sqlite");
}

export function getDatabase(): DatabaseSync {
  if (!globalForDatabase.arenaDatabase) {
    const filename = databasePath();
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename);
    db.exec(SCHEMA_SQL);
    db.exec("PRAGMA busy_timeout = 10000");
    const comboColumns = db.prepare("PRAGMA table_info(combos)").all() as Array<{ name: string }>;
    if (!comboColumns.some((column) => column.name === "origin")) {
      db.exec("ALTER TABLE combos ADD COLUMN origin TEXT NOT NULL DEFAULT 'curated'");
      db.exec("UPDATE combos SET origin = CASE WHEN generated = 1 THEN 'generated' ELSE 'curated' END");
    }
    const videoColumns = db.prepare("PRAGMA table_info(videos)").all() as Array<{ name: string }>;
    if (!videoColumns.some((column) => column.name === "catalog_position")) {
      db.exec("ALTER TABLE videos ADD COLUMN catalog_position INTEGER NOT NULL DEFAULT 0");
    }
    globalForDatabase.arenaDatabase = db;
  }
  return globalForDatabase.arenaDatabase;
}

export function jsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
