import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_EXTREME_SCENARIO, loadExtremeAugments, loadExtremeItems, loadResolverChampion } from "../src/engine/catalog";
import { generateAugmentCombinations } from "../src/engine/extreme-finder";
import { resolveArenaStats } from "../src/engine/resolver";

function shuffle<T>(input: readonly T[], seed = 0xA6EAA): T[] {
  const values = [...input];
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const selected = state % (index + 1);
    [values[index], values[selected]] = [values[selected], values[index]];
  }
  return values;
}

const appDb = path.join(process.env.APPDATA ?? "", "Arena Build Lab", "data", "arena.sqlite");
const filename = path.resolve(process.env.ARENA_DB_PATH ?? (fs.existsSync(appDb) ? appDb : "data/arena.sqlite"));
const db = new DatabaseSync(filename, { readOnly: true });
try {
  const champions = ["Sion", "Ezreal"].map((name) => loadResolverChampion(db, name));
  if (champions.some((champion) => !champion)) throw new Error("Sion or Ezreal is missing from the local catalog.");
  const augments = loadExtremeAugments(db, DEFAULT_EXTREME_SCENARIO);
  const combinations = shuffle(generateAugmentCombinations(augments));
  if (combinations.length < 250) throw new Error(`Only ${combinations.length} valid rarity combinations are available; 250 are required.`);
  const items = loadExtremeItems(db);
  const seen = new Set<string>();
  const timings: number[] = [];
  let resolvedCount = 0;
  for (const champion of champions) {
    if (!champion) continue;
    for (const combination of combinations.slice(0, 250)) {
      const key = `${champion.key}:${combination.map((effect) => effect.key).sort().join("|")}`;
      if (seen.has(key)) throw new Error(`Duplicate resolver input detected: ${key}`);
      seen.add(key);
      const started = performance.now();
      const result = resolveArenaStats(champion, 18, [...combination, ...items], { maxIterations: 250, scenario: { flatStats: { cursedPower: 500 }, sionSoulFurnace: champion.key === "Sion" ? { smallUnits: 13_200 } : undefined, maxMagnitude: 1e15 } });
      const elapsed = performance.now() - started;
      if (elapsed >= 1_000) throw new Error(`${key} took ${elapsed.toFixed(1)}ms.`);
      for (const [stat, value] of Object.entries(result.stats)) if (!Number.isFinite(value)) throw new Error(`${key} produced ${stat}=${value}.`);
      if (!Number.isFinite(result.delta)) throw new Error(`${key} produced a non-finite convergence delta.`);
      timings.push(elapsed);
      resolvedCount += 1;
    }
  }
  const report = { database: filename, combinations: resolvedCount, duplicates: resolvedCount - seen.size, maxMilliseconds: Math.max(...timings), averageMilliseconds: timings.reduce((sum, value) => sum + value, 0) / timings.length };
  fs.mkdirSync(path.resolve("qa"), { recursive: true });
  fs.writeFileSync(path.resolve("qa/stress-resolver-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
