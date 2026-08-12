import assert from "node:assert/strict";
import test from "node:test";
import { resolveArenaBuild, resolveArenaStats, type ResolverChampion, type ResolverEffect } from "../src/engine/resolver";
import { generateAugmentCombinations } from "../src/engine/extreme-finder";

const champion: ResolverChampion = {
  key: "Test",
  name: "Test Champion",
  stats: {
    health: 1000,
    healthPerLevel: 100,
    mana: 500,
    manaPerLevel: 50,
    attackDamage: 100,
    attackDamagePerLevel: 5,
    attackSpeed: 0.7,
    attackSpeedPerLevel: 2,
    armor: 30,
    armorPerLevel: 4,
    magicResistance: 32,
    magicResistancePerLevel: 2,
    moveSpeed: 350,
  },
};

function effect(name: string, partial: Partial<ResolverEffect> = {}): ResolverEffect {
  return { key: name, name, kind: "augment", rarity: "silver", rank: 1, ...partial };
}

test("builds level-scaled champion base stats", () => {
  const result = resolveArenaStats(champion, 18, []);
  assert.equal(result.status, "converged");
  assert.equal(result.stats.maxHealth, 2700);
  assert.equal(result.stats.maxMana, 1350);
  assert.equal(result.stats.totalAttackDamage, 185);
  assert.equal(result.stats.armor, 98);
  assert.equal(result.stats.magicResistance, 66);
  assert(Math.abs(result.stats.attackSpeed - 0.938) < 1e-9);
});

test("reports ability haste and its diminishing effective cooldown reduction", () => {
  const result = resolveArenaStats(champion, 1, [effect("Haste", { flat: { abilityHaste: 100 } })]);
  assert.equal(result.stats.abilityHaste, 100);
  assert.equal(result.stats.effectiveCooldownReductionPercent, 50);
});

test("resolves champion and augment IDs through a caller-provided pure catalog", () => {
  const haste = effect("Haste", { key: "augment:haste", flat: { abilityHaste: 25 } });
  const result = resolveArenaBuild({
    championId: "Test",
    level: 1,
    augmentIds: ["augment:haste"],
    catalog: { champions: [champion], effects: [haste] },
  });
  assert.equal(result.stats.abilityHaste, 25);
});

test("solves a contracting recursive HP to AD to AP to HP graph", () => {
  const effects = [
    effect("HP to AD", { rules: [{ source: "maxHealth", target: "bonusAttackDamage", coefficient: 0.03 }] }),
    effect("AD to AP", { rules: [{ source: "totalAttackDamage", target: "abilityPower", coefficient: 0.5 }] }),
    effect("AP to HP", { rules: [{ source: "abilityPower", target: "maxHealth", coefficient: 0.2 }] }),
  ];
  const result = resolveArenaStats(champion, 1, effects, { epsilon: 1e-10 });
  assert.equal(result.status, "converged");
  assert(Math.abs(result.stats.maxHealth - 1013.039117352) < 1e-6);
  assert(Math.abs(result.stats.totalAttackDamage - 130.39117352) < 1e-6);
  assert(Math.abs(result.stats.abilityPower - 65.19558676) < 1e-6);
  assert(result.iterations > 3);
});

test("reports a non-contracting conversion cycle as divergent", () => {
  const result = resolveArenaStats(champion, 1, [
    effect("AP to HP", { flat: { abilityPower: 10 }, rules: [{ source: "abilityPower", target: "maxHealth", coefficient: 2, mode: "convert" }] }),
    effect("HP to AP", { rules: [{ source: "maxHealth", target: "abilityPower", coefficient: 1, mode: "convert" }] }),
  ], { maxIterations: 40, scenario: { maxMagnitude: 1e9 } });
  assert.equal(result.status, "diverged");
});

test("a converted stat remains available to downstream equations but is zero in the presented result", () => {
  const result = resolveArenaStats(champion, 1, [
    effect("Health AD", { rules: [{ source: "bonusHealth", target: "bonusAttackDamage", coefficient: 0.03 }] }),
    effect("ADAPt", { rules: [{ source: "bonusAttackDamage", target: "abilityPower", coefficient: 2, mode: "convert" }] }),
  ], { scenario: { flatStats: { maxHealth: 1000 } } });
  assert.equal(result.status, "converged");
  assert.equal(result.stats.bonusAttackDamage, 0);
  assert.equal(result.stats.totalAttackDamage, 100);
  assert.equal(result.stats.abilityPower, 60);
});

test("enforces the Arena attack-speed cap and an augment cap override", () => {
  const speed = effect("Speed", { flat: { bonusAttackSpeedPercent: 1000 } });
  assert.equal(resolveArenaStats(champion, 1, [speed]).stats.attackSpeed, 2.5);
  assert(Math.abs(resolveArenaStats(champion, 1, [{ ...speed, attackSpeedCap: 10 }]).stats.attackSpeed - 7.7) < 1e-9);
});

test("models finite Sion Soul Furnace stacks and identifies unlimited inputs", () => {
  const sion = { ...champion, key: "Sion", name: "Sion" };
  const finite = resolveArenaStats(sion, 1, [], { scenario: { sionSoulFurnace: { smallUnits: 10, largeUnits: 2, championKills: 1 } } });
  assert.equal(finite.stats.maxHealth, 1085);
  const unlimited = resolveArenaStats(sion, 1, [], { scenario: { sionSoulFurnace: { smallUnits: Number.POSITIVE_INFINITY } } });
  assert.equal(unlimited.status, "unbounded");
  assert.equal(unlimited.stats.maxHealth, Number.POSITIVE_INFINITY);
});

test("reproduces the finite 500k+ HP Sion benchmark without hiding unlimited scaling", () => {
  const sion: ResolverChampion = {
    id: 14,
    key: "Sion",
    name: "Sion",
    stats: { health: 655, healthPerLevel: 87, mana: 400, manaPerLevel: 52, attackDamage: 68, attackDamagePerLevel: 0, attackSpeed: 0.679, attackSpeedPerLevel: 1.3, armor: 36, armorPerLevel: 4.2, magicResistance: 32, magicResistancePerLevel: 2.05, moveSpeed: 345 },
  };
  const effects = [
    effect("Goliath", { rarity: "prismatic", multipliers: [{ stat: "maxHealth", factor: 1.5 }] }),
    effect("Tank Engine", { rarity: "gold", multipliers: [{ stat: "bonusHealth", factor: 2.2 }] }),
    effect("Quest: Steel Your Heart", { rarity: "gold", flat: { maxHealth: 96_000 } }),
    effect("Mind to Matter", { rules: [{ source: "maxMana", target: "maxHealth", coefficient: 0.7 }] }),
    { ...effect("Overlord's Bloodmail", { flat: { maxHealth: 400, bonusAttackDamage: 40 } }), kind: "item" as const },
  ];
  const result = resolveArenaStats(sion, 18, effects, { scenario: { flatStats: { maxHealth: 48_000 }, sionSoulFurnace: { smallUnits: 13_200 } } });
  assert.equal(result.status, "converged");
  assert(result.stats.maxHealth > 500_000);
});

test("generates every 1-prismatic, 2-gold, 1-silver combination", () => {
  const augments = [
    effect("P1", { rarity: "prismatic" }), effect("P2", { rarity: "prismatic" }),
    effect("G1", { rarity: "gold" }), effect("G2", { rarity: "gold" }), effect("G3", { rarity: "gold" }),
    effect("S1"), effect("S2"),
  ];
  const combinations = generateAugmentCombinations(augments);
  assert.equal(combinations.length, 2 * 3 * 2);
  assert(combinations.every((combination) => combination.filter((augment) => augment.rarity === "gold").length === 2));
});
