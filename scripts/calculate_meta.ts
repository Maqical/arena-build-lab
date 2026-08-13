import fs from "node:fs";
import path from "node:path";
import { runMetaCalculation } from "../src/lib/meta-aggregation";

if (process.argv.includes("--stress") && !process.env.ARENA_DB_PATH) {
  const desktopDatabase = path.join(process.env.APPDATA ?? "", "Arena Build Lab", "data", "arena.sqlite");
  if (!fs.existsSync(desktopDatabase)) throw new Error(`Stress database was not found at ${desktopDatabase}. Run npm run stress:crawl first.`);
  process.env.ARENA_DB_PATH = desktopDatabase;
}

runMetaCalculation();
