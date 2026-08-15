import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function csv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
const objectiveArg = process.argv.find((argument) => argument.startsWith("--objective="));
const topArg = process.argv.find((argument) => argument.startsWith("--top="));
const outputPath = path.resolve(process.cwd(), outputArg?.slice("--output=".length) || "data/extreme_builds.csv");
const objective = objectiveArg?.slice("--objective=".length) ?? "";
const topPerGroup = Math.max(1, Math.trunc(Number(topArg?.slice("--top=".length)) || 100));
const databasePath = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(databasePath, { readOnly: true });
const rows = db.prepare(`
  SELECT champion_name, level, objective, result_rank, score,
    theoretical_unbounded, status, augments_json,
    stats_json, scenario_json
  FROM extreme_builds WHERE (? = '' OR objective = ?)
  ORDER BY objective, score DESC, champion_name, result_rank ASC
`).all(objective, objective) as Array<Record<string, unknown>>;

// The UI parser (extreme-build-csv-core.ts) requires this exact 18-column
// layout, with plain augment names. Ranks are global per objective across
// all champions (the single best maxHealth build is rank 1, etc.).
const headers = [
  "objective", "rank", "champion", "level", "benchmark_score", "theoretical_unbounded", "status",
  "augments", "fixed_items", "max_health", "total_ad", "ap", "attack_speed",
  "armor", "mr", "ability_haste", "effective_cdr_percent", "scenario",
];
const lines = [headers.join(",")];
const rankByObjective = new Map<string, number>();
for (const row of rows) {
  const rank = (rankByObjective.get(String(row.objective)) ?? 0) + 1;
  if (rank > topPerGroup) continue;
  rankByObjective.set(String(row.objective), rank);
  const stats = JSON.parse(String(row.stats_json)) as Record<string, number>;
  const effects = JSON.parse(String(row.augments_json)) as Array<{ name: string; kind: string; rank: number }>;
  lines.push([
    row.objective, rank, row.champion_name, row.level, row.score,
    Boolean(row.theoretical_unbounded), row.status,
    effects.filter((effect) => effect.kind === "augment").map((effect) => effect.name).join(" + "),
    effects.filter((effect) => effect.kind === "item").map((effect) => effect.name).join(" + "),
    stats.maxHealth, stats.totalAttackDamage, stats.abilityPower,
    stats.attackSpeed, stats.armor, stats.magicResistance, stats.abilityHaste,
    stats.effectiveCooldownReductionPercent,
    row.scenario_json,
  ].map(csv).join(","));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ outputPath, rows: lines.length - 1, objective: objective || "all", topPerGroup }, null, 2));