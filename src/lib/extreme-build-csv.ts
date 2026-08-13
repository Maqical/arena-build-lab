import "server-only";

import fs from "node:fs";
import path from "node:path";
import { parseExtremeBuildCsv, type ExtremeBuildCsvRow } from "@/lib/extreme-build-csv-core";

export function getExtremeBuildCsvRows(): ExtremeBuildCsvRow[] {
  const filename = process.env.ARENA_EXTREME_CSV_PATH || path.join(process.cwd(), "data", "extreme_builds.csv");
  try { return parseExtremeBuildCsv(fs.readFileSync(/* turbopackIgnore: true */ filename, "utf8")); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
