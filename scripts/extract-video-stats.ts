import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractVideoStatClaims } from "../src/lib/video-stat-claims";
import { SCHEMA_SQL } from "../src/lib/schema";

const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(filename);
db.exec(SCHEMA_SQL);
db.exec("PRAGMA busy_timeout = 10000");
const result = extractVideoStatClaims(db);
console.log(JSON.stringify({ ...result, database: filename }, null, 2));
db.close();
