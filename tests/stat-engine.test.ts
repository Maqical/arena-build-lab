import assert from "node:assert/strict";
import test from "node:test";
import { calculateStatChain, EMPTY_STATS } from "../src/lib/stat-engine";
import type { StatFormula } from "../src/lib/types";

function formula(overrides: Partial<StatFormula> & Pick<StatFormula, "id" | "entityName" | "sourceStat" | "targetStat" | "operation">): StatFormula {
  return {
    entityKey: overrides.id,
    iconUrl: "",
    patch: "test",
    sourceUrl: "",
    ranks: [{ level: 1, coefficient: 1 }],
    description: "",
    formulaText: "",
    confidence: "exact",
    order: 10,
    ...overrides,
  };
}

test("chains mana into health and the resulting bonus health into attack damage", () => {
  const formulas = [
    formula({ id: "mind", entityName: "Mind to Matter", sourceStat: "maxMana", targetStat: "bonusHealth", operation: "gain", ranks: [{ level: 1, coefficient: 0.35 }], order: 10 }),
    formula({ id: "bloodmail", entityName: "Overlord's Bloodmail", sourceStat: "bonusHealth", targetStat: "bonusAttackDamage", operation: "gain", ranks: [{ level: 1, coefficient: 0.03 }], order: 20 }),
  ];
  const result = calculateStatChain({ ...EMPTY_STATS, maxHealth: 2000, bonusHealth: 500, maxMana: 1000 }, formulas, [
    { formulaId: "bloodmail", level: 1 },
    { formulaId: "mind", level: 1 },
  ]);
  assert.equal(result.stats.maxHealth, 2350);
  assert.equal(result.stats.bonusHealth, 850);
  assert.equal(result.stats.bonusAttackDamage, 25.5);
  assert.deepEqual(result.steps.map((step) => step.formulaId), ["mind", "bloodmail"]);
});

test("conversion consumes its source and applies the target amplifier", () => {
  const adapt = formula({
    id: "adapt", entityName: "ADAPt", sourceStat: "bonusAttackDamage", targetStat: "abilityPower", operation: "convert",
    ranks: [{ level: 1, coefficient: 1.66666, targetMultiplier: 1.15 }],
  });
  const result = calculateStatChain({ ...EMPTY_STATS, bonusAttackDamage: 100, abilityPower: 50 }, [adapt], [{ formulaId: "adapt", level: 1 }]);
  assert.equal(result.stats.bonusAttackDamage, 0);
  assert(Math.abs(result.stats.abilityPower - 249.1659) < 0.001);
});

test("Aim for the Head caps chance and moves overflow into critical damage", () => {
  const aim = formula({ id: "aim", entityName: "Aim for the Head", sourceStat: "critChancePercent", targetStat: "critDamagePercent", operation: "overflow_crit", ranks: [{ level: 1, coefficient: 0.4 }] });
  const result = calculateStatChain({ ...EMPTY_STATS, critChancePercent: 60, critDamagePercent: 175 }, [aim], [{ formulaId: "aim", level: 1 }]);
  assert.equal(result.stats.critChancePercent, 50);
  assert.equal(result.stats.critDamagePercent, 214);
});

test("does not execute a circular pair of stat conversions twice", () => {
  const adapt = formula({ id: "adapt", entityName: "ADAPt", sourceStat: "bonusAttackDamage", targetStat: "abilityPower", operation: "convert", ranks: [{ level: 1, coefficient: 2 }], order: 10 });
  const escapade = formula({ id: "escapade", entityName: "escAPADe", sourceStat: "abilityPower", targetStat: "bonusAttackDamage", operation: "convert", ranks: [{ level: 1, coefficient: 0.8 }], order: 20 });
  const result = calculateStatChain({ ...EMPTY_STATS, bonusAttackDamage: 100 }, [adapt, escapade], [{ formulaId: "adapt", level: 1 }, { formulaId: "escapade", level: 1 }]);
  assert.equal(result.stats.abilityPower, 200);
  assert.equal(result.stats.bonusAttackDamage, 0);
  assert.equal(result.steps.length, 1);
  assert.equal(result.warnings.length, 1);
});

test("a total-AD amplifier includes base AD without converting it into bonus AD twice", () => {
  const escapade = formula({
    id: "escapade", entityName: "escAPADe", sourceStat: "abilityPower", targetStat: "bonusAttackDamage", operation: "convert",
    ranks: [{ level: 1, coefficient: 0.6, targetMultiplier: 1.15 }], multiplierBaseStat: "baseAttackDamage",
  });
  const result = calculateStatChain({ ...EMPTY_STATS, baseAttackDamage: 100, bonusAttackDamage: 20, abilityPower: 200 }, [escapade], [{ formulaId: "escapade", level: 1 }]);
  assert.equal(result.stats.baseAttackDamage, 100);
  assert.equal(result.stats.abilityPower, 0);
  assert.equal(result.stats.bonusAttackDamage, 176);
});
