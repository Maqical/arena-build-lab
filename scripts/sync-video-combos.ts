import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";
import { rebuildVideoCombos } from "../src/lib/video-combos";

const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(filename);
db.exec(SCHEMA_SQL);
db.exec("PRAGMA busy_timeout = 10000");

const columns = db.prepare("PRAGMA table_info(combos)").all() as Array<{ name: string }>;
if (!columns.some((column) => column.name === "origin")) {
  db.exec("ALTER TABLE combos ADD COLUMN origin TEXT NOT NULL DEFAULT 'curated'");
  db.exec("UPDATE combos SET origin = CASE WHEN generated = 1 THEN 'generated' ELSE 'curated' END");
}

const patch = (db.prepare("SELECT value FROM metadata WHERE key='patch'").get() as { value?: string } | undefined)?.value ?? "unknown";
const inserted = rebuildVideoCombos(db, patch);
console.log(JSON.stringify({ videoCombos: inserted, patch, database: filename }, null, 2));
db.close();
