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
    db.exec(`
      INSERT OR IGNORE INTO participant_augments(match_id, participant_index, augment_id, slot_index)
      SELECT rp.match_id, rp.participant_index, CAST(j.value AS INTEGER), CAST(j.key AS INTEGER)
      FROM riot_participants rp, json_each(rp.augments_json) j
      WHERE CAST(j.value AS INTEGER) > 0
    `);
    const comboColumns = db.prepare("PRAGMA table_info(combos)").all() as Array<{ name: string }>;
    if (!comboColumns.some((column) => column.name === "origin")) {
      db.exec("ALTER TABLE combos ADD COLUMN origin TEXT NOT NULL DEFAULT 'curated'");
      db.exec("UPDATE combos SET origin = CASE WHEN generated = 1 THEN 'generated' ELSE 'curated' END");
    }
    const videoColumns = db.prepare("PRAGMA table_info(videos)").all() as Array<{ name: string }>;
    if (!videoColumns.some((column) => column.name === "catalog_position")) {
      db.exec("ALTER TABLE videos ADD COLUMN catalog_position INTEGER NOT NULL DEFAULT 0");
    }
    const runEntityColumns = db.prepare("PRAGMA table_info(personal_run_entities)").all() as Array<{ name: string }>;
    if (runEntityColumns.length > 0 && !runEntityColumns.some((column) => column.name === "entity_name")) {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(`
        BEGIN;
        ALTER TABLE personal_run_entities RENAME TO personal_run_entities_legacy;
        CREATE TABLE personal_run_entities (
          run_id INTEGER NOT NULL REFERENCES personal_runs(id) ON DELETE CASCADE,
          entity_key TEXT NOT NULL,
          entity_name TEXT NOT NULL,
          entity_kind TEXT NOT NULL CHECK (entity_kind IN ('augment', 'item')),
          icon_url TEXT NOT NULL,
          rarity TEXT NOT NULL,
          pick_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(run_id, entity_key)
        );
        INSERT INTO personal_run_entities(run_id, entity_key, entity_name, entity_kind, icon_url, rarity, pick_order)
        SELECT pre.run_id, pre.entity_key, e.name, e.kind, e.icon_url, e.rarity, pre.pick_order
        FROM personal_run_entities_legacy pre JOIN entities e ON e.entity_key = pre.entity_key;
        DROP TABLE personal_run_entities_legacy;
        CREATE INDEX personal_run_entities_entity_idx ON personal_run_entities(entity_key);
        COMMIT;
      `);
      db.exec("PRAGMA foreign_keys = ON");
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

/** Returns whether the replaceable local Riot projection has any rows. */
export function hasLocalMetaSnapshots(): boolean {
  return Number(getDatabase().prepare("SELECT COUNT(*) AS count FROM meta_snapshots WHERE source = 'riot_api_local'").get()?.count ?? 0) > 0;
}
