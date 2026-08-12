import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_EXTREME_SCENARIO, loadExtremeAugments, loadExtremeItems, loadResolverChampion } from "../src/engine/catalog";
import { findExtremeBuilds, type ExtremeObjective } from "../src/engine/extreme-finder";
import type { ResolverChampion, ResolverScenario } from "../src/engine/resolver";

const TARGET_CHAMPIONS = ["Sion", "Chogath", "Ezreal", "Shyvana"];
const OBJECTIVES = ["maxHealth", "totalAttackDamage", "abilityPower", "attackSpeed"] as const satisfies readonly ExtremeObjective[];
const OUTPUT_PATH = path.resolve(process.cwd(), "data/extreme_builds.csv");
const scenarioInputs = { ...DEFAULT_EXTREME_SCENARIO, heartsteelStacks: 48_000 };

function scenarioForChampion(champion: ResolverChampion): ResolverScenario {
  return {
    flatStats: { maxHealth: scenarioInputs.heartsteelStacks, cursedPower: scenarioInputs.cursedPower },
    sionSoulFurnace: champion.key === "Sion" ? { smallUnits: 13_200 } : undefined,
    championPermanentHealth: champion.key === "Chogath" ? 50 * 160 : 0,
    maxMagnitude: 1e15,
  };
}

function csv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const databasePath = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(databasePath, { readOnly: true });
const champions = TARGET_CHAMPIONS.flatMap((name) => loadResolverChampion(db, name) ?? []);
if (champions.length !== TARGET_CHAMPIONS.length) throw new Error("One or more target champions are missing. Run npm run data:sync first.");

const augments = loadExtremeAugments(db, scenarioInputs);
const fixedItems = loadExtremeItems(db);
const builds = findExtremeBuilds({
  champions,
  augments,
  fixedEffects: fixedItems,
  objectives: OBJECTIVES,
  topPerChampionObjective: 10,
  scenarioForChampion,
});
const selected = OBJECTIVES.flatMap((objective) => builds
  .filter((build) => build.objective === objective)
  .sort((left, right) => Number(right.theoreticalUnbounded) - Number(left.theoreticalUnbounded) || right.score - left.score)
  .slice(0, 10));

const headers = [
  "objective", "rank", "champion", "level", "benchmark_score", "theoretical_unbounded", "status", "augments", "fixed_items",
  "max_health", "total_ad", "ap", "attack_speed", "armor", "mr", "ability_haste", "effective_cdr_percent", "scenario",
];
const rankByObjective = new Map<string, number>();
const lines = [headers.join(",")];
for (const build of selected) {
  const rank = (rankByObjective.get(build.objective) ?? 0) + 1;
  rankByObjective.set(build.objective, rank);
  const augmentsInBuild = build.effects.filter((effect) => effect.kind === "augment").map((effect) => effect.name).join(" + ");
  const itemsInBuild = build.effects.filter((effect) => effect.kind === "item").map((effect) => effect.name).join(" + ");
  lines.push([
    build.objective, rank, build.championName, build.level, build.score, build.theoreticalUnbounded, build.status,
    augmentsInBuild, itemsInBuild, build.stats.maxHealth, build.stats.totalAttackDamage, build.stats.abilityPower,
    build.stats.attackSpeed, build.stats.armor, build.stats.magicResistance, build.stats.abilityHaste,
    build.stats.effectiveCooldownReductionPercent,
    JSON.stringify({ ...scenarioInputs, sionSmallUnits: 13_200, chogathFeastStacks: 50 }),
  ].map(csv).join(","));
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  output: OUTPUT_PATH,
  champions: champions.map((champion) => champion.name),
  executableAugments: augments.length,
  fixedItems: fixedItems.map((item) => item.name),
  rows: selected.length,
  top: Object.fromEntries(OBJECTIVES.map((objective) => [objective, selected.find((build) => build.objective === objective)?.score ?? null])),
}, null, 2));
