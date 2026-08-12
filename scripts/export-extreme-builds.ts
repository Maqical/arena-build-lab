import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function csv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
const objectiveArg = process.argv.find((argument) => argument.startsWith("--objective="));
const outputPath = path.resolve(process.cwd(), outputArg?.slice("--output=".length) || "data/extreme-builds-top-100.csv");
const objective = objectiveArg?.slice("--objective=".length) ?? "";
const databasePath = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(databasePath, { readOnly: true });
const rows = db.prepare(`
  SELECT champion_name, champion_key, level, objective, result_rank, score,
    theoretical_unbounded, unbounded_reason, status, augments_json,
    stats_json, scenario_name, scenario_json, patch, generated_at
  FROM extreme_builds WHERE (? = '' OR objective = ?)
  ORDER BY result_rank ASC, theoretical_unbounded DESC, objective, score DESC, champion_name
  LIMIT 100
`).all(objective, objective) as Array<Record<string, unknown>>;

const headers = [
  "champion", "champion_key", "level", "objective", "rank", "benchmark_score",
  "theoretical_unbounded", "unbounded_reason", "status", "effects",
  "max_health", "total_ad", "ap", "ability_haste", "move_speed", "attack_speed",
  "crit_damage_percent", "on_hit_physical", "scenario", "scenario_inputs", "patch", "generated_at",
];
const lines = [headers.join(",")];
for (const row of rows) {
  const stats = JSON.parse(String(row.stats_json)) as Record<string, number>;
  const effects = JSON.parse(String(row.augments_json)) as Array<{ name: string; kind: string; rank: number }>;
  lines.push([
    row.champion_name, row.champion_key, row.level, row.objective, row.result_rank, row.score,
    Boolean(row.theoretical_unbounded), row.unbounded_reason, row.status,
    effects.map((effect) => `${effect.name} [${effect.kind}] (L${effect.rank})`).join(" + "),
    stats.maxHealth, stats.totalAttackDamage, stats.abilityPower, stats.abilityHaste,
    stats.moveSpeed, stats.attackSpeed, stats.critDamagePercent, stats.onHitPhysicalDamage,
    row.scenario_name, row.scenario_json, row.patch, row.generated_at,
  ].map(csv).join(","));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ outputPath, rows: rows.length, objective: objective || "all" }, null, 2));
