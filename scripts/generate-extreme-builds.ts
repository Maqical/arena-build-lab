import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_EXTREME_SCENARIO, loadExtremeAugments, loadExtremeItems, loadResolverChampion } from "../src/engine/catalog";
import { EXTREME_OBJECTIVES, findExtremeBuilds, type ExtremeBuild } from "../src/engine/extreme-finder";
import type { ResolverChampion, ResolverScenario } from "../src/engine/resolver";
import { SCHEMA_SQL } from "../src/lib/schema";

const SCENARIO_NAME = "high-stack-benchmark-v1";
const TARGET_CHAMPIONS = [
  "Sion", "Chogath", "Swain", "Shyvana", "Senna", "Thresh",
  "Nasus", "Veigar", "Smolder", "Kindred", "Belveth", "DrMundo",
  "Trundle", "Volibear", "Taric", "Warwick",
  "Mordekaiser", "Illaoi", "Gwen", "Briar", "Sett", "Darius", "Garen", "Urgot",
  "Nilah", "Draven", "KogMaw", "Vayne", "Twitch", "Aphelios",
];
const scenarioInputs = {
  ...DEFAULT_EXTREME_SCENARIO,
  heartsteelStacks: 48_000,
  takedowns: 24,
  cursedPower: 500,
  phenomenalEvilProcs: 100,
};

function scenarioForChampion(champion: ResolverChampion): ResolverScenario {
  return {
    flatStats: { maxHealth: scenarioInputs.heartsteelStacks, cursedPower: scenarioInputs.cursedPower },
    sionSoulFurnace: champion.key === "Sion" ? { smallUnits: 13_200 } : undefined,
    championPermanentHealth: champion.key === "Chogath" ? 50 * 160 : 0,
    maxMagnitude: 1e15,
  };
}

const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const db = new DatabaseSync(filename);
db.exec(SCHEMA_SQL);
db.exec("PRAGMA busy_timeout = 10000");

const patch = String((db.prepare("SELECT value FROM metadata WHERE key = 'patch'").get() as { value?: string } | undefined)?.value ?? "unknown");
const requestedChampions = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const championNames = requestedChampions.length > 0 ? requestedChampions : TARGET_CHAMPIONS;
const champions = championNames.flatMap((name) => loadResolverChampion(db, name) ?? []);
if (champions.length === 0) throw new Error("No requested champions were found. Run npm run data:sync first.");

const augments = loadExtremeAugments(db, scenarioInputs);
const fixedEffects = loadExtremeItems(db);
const rarityCounts = Object.fromEntries(["prismatic", "gold", "silver"].map((rarity) => [rarity, augments.filter((augment) => augment.rarity === rarity).length]));
if (rarityCounts.prismatic < 1 || rarityCounts.gold < 2 || rarityCounts.silver < 1) {
  throw new Error(`The executable augment catalog cannot satisfy 1P/2G/1S: ${JSON.stringify(rarityCounts)}`);
}
const combinationsPerChampion = Number(rarityCounts.prismatic) *
  (Number(rarityCounts.gold) * (Number(rarityCounts.gold) - 1) / 2) *
  Number(rarityCounts.silver);

const builds = findExtremeBuilds({
  champions,
  augments,
  objectives: EXTREME_OBJECTIVES,
  fixedEffects,
  topPerChampionObjective: 100,
  scenarioForChampion,
});

const scenarioJson = JSON.stringify({
  ...scenarioInputs,
  sionSoulFurnaceSmallUnits: 13_200,
  chogathChampionFeastStacks: 50,
  chogathHealthPerStack: 160,
  note: "Finite comparison benchmark. Unbounded flags describe the actual theoretical ceiling.",
});
const generatedAt = new Date().toISOString();
const insert = db.prepare(`
  INSERT INTO extreme_builds(
    champion_key, champion_name, level, objective, result_rank, score,
    theoretical_unbounded, unbounded_reason, status, stats_json,
    augment_keys_json, augments_json, scenario_name, scenario_json,
    iterations, delta, patch, generated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.exec("BEGIN");
try {
  db.prepare("DELETE FROM extreme_builds WHERE scenario_name = ? AND patch = ?").run(SCENARIO_NAME, patch);
  const ranks = new Map<string, number>();
  for (const build of builds) {
    const group = `${build.championKey}:${build.objective}`;
    const rank = (ranks.get(group) ?? 0) + 1;
    ranks.set(group, rank);
    insert.run(
      build.championKey,
      build.championName,
      build.level,
      build.objective,
      rank,
      build.score,
      build.theoreticalUnbounded ? 1 : 0,
      build.unboundedReason,
      build.status,
      JSON.stringify(build.stats),
      JSON.stringify(build.effects.map((effect) => effect.key)),
      JSON.stringify(build.effects),
      SCENARIO_NAME,
      scenarioJson,
      build.iterations,
      build.delta,
      patch,
      generatedAt,
    );
  }
  db.prepare(`
    INSERT INTO metadata(key, value, updated_at) VALUES ('last_extreme_sync', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(generatedAt, generatedAt);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

function top(buildsToSearch: ExtremeBuild[], championKey: string, objective: ExtremeBuild["objective"]) {
  return buildsToSearch.find((build) => build.championKey === championKey && build.objective === objective);
}

console.log(JSON.stringify({
  patch,
  scenario: SCENARIO_NAME,
  champions: champions.map((champion) => champion.name),
  executableAugments: augments.length,
  fixedEffects: fixedEffects.map((effect) => effect.name),
  rarityCounts,
  combinationsPerChampion,
  resolverRuns: combinationsPerChampion * champions.length,
  storedBuilds: builds.length,
  highlights: [
    top(builds, "Sion", "maxHealth"),
    top(builds, "Chogath", "maxHealth"),
    ...champions.map((champion) => top(builds, champion.key, "totalAttackDamage")),
  ].filter(Boolean).map((build) => ({
    champion: build?.championName,
    objective: build?.objective,
    score: build?.score,
    theoreticalUnbounded: build?.theoreticalUnbounded,
    effects: build?.effects.map((effect) => effect.name),
  })),
}, null, 2));
