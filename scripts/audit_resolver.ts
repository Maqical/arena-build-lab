import fs from "node:fs";
import path from "node:path";
import { parseExtremeBuildCsv } from "../src/lib/extreme-build-csv-core";
import { resolveArenaStats, type ResolverChampion, type ResolverEffect } from "../src/engine/resolver";

const champion: ResolverChampion = { key: "Audit", name: "Audit", stats: { health: 1000, healthPerLevel: 90, mana: 500, manaPerLevel: 40, attackDamage: 100, attackDamagePerLevel: 4, attackSpeed: .7, attackSpeedPerLevel: 2, armor: 30, armorPerLevel: 4, magicResistance: 30, magicResistancePerLevel: 2, moveSpeed: 340 } };
const effect = (key: string, rules: NonNullable<ResolverEffect["rules"]>): ResolverEffect => ({ key, name: key, kind: "augment", rarity: "gold", rank: 1, rules });
const cases: ResolverEffect[][] = [[], [effect("hp", [{ source: "abilityPower", target: "maxHealth", coefficient: 2 }])], [effect("loop-a", [{ source: "abilityPower", target: "maxHealth", coefficient: .1 }]), effect("loop-b", [{ source: "maxHealth", target: "abilityPower", coefficient: .01 }])]];
const results = cases.map((effects) => resolveArenaStats(champion, 18, effects));
for (const result of results) for (const value of Object.values(result.stats)) if (!Number.isFinite(value)) throw new Error("Resolver produced a non-finite stat.");
const csv = parseExtremeBuildCsv(fs.readFileSync(path.resolve("data/extreme_builds.csv"), "utf8"));
const sion = csv.find((row) => row.champion === "Sion" && row.objective === "maxHealth");
if (!sion || sion.stats.maxHealth < 500_000) throw new Error("The recorded Sion benchmark is missing or below 500k HP.");
console.log(JSON.stringify({ cases: results.map((result) => ({ status: result.status, iterations: result.iterations })), sionMaxHealth: sion.stats.maxHealth, rows: csv.length }, null, 2));
