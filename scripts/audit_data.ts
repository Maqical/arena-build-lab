import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";

const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(filename); db.exec(SCHEMA_SQL);
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
const counts = Object.fromEntries(tables.map((table) => [table, Number((db.prepare(`SELECT COUNT(*) count FROM "${table}"`).get() as { count: number }).count)]));
const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
const orphanParticipants = Number((db.prepare("SELECT COUNT(*) count FROM riot_participants p LEFT JOIN riot_matches m ON m.match_id=p.match_id WHERE m.match_id IS NULL").get() as { count: number }).count);
const missingChampionMeta = Number((db.prepare("SELECT COUNT(*) count FROM champions c WHERE NOT EXISTS (SELECT 1 FROM meta_snapshots m WHERE m.entity_key='champion:'||c.champion_key)").get() as { count: number }).count);
const missingAugmentMeta = Number((db.prepare("SELECT COUNT(*) count FROM entities e WHERE e.kind='augment' AND NOT EXISTS (SELECT 1 FROM meta_snapshots m WHERE m.entity_key=e.entity_key)").get() as { count: number }).count);
const issues = [...(foreignKeys.length ? [`${foreignKeys.length} foreign-key violations`] : []), ...(orphanParticipants ? [`${orphanParticipants} orphan participants`] : [])];
console.log(JSON.stringify({ database: filename, counts, integrity: { foreignKeys, orphanParticipants, missingChampionMeta, missingAugmentMeta }, issues }, null, 2));
db.close(); if (issues.length) process.exitCode = 1;
