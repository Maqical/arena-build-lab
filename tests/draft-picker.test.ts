import assert from "node:assert/strict";
import test from "node:test";
import { compareDraftOptions } from "../src/engine/draft-picker";
import type { ResolverChampion, ResolverEffect } from "../src/engine/resolver";

const champion: ResolverChampion = {
  key: "PickerTest",
  name: "Picker Test",
  stats: { health: 1_000, healthPerLevel: 0, mana: 500, manaPerLevel: 0, attackDamage: 100, attackDamagePerLevel: 0, attackSpeed: 0.7, attackSpeedPerLevel: 0, armor: 30, armorPerLevel: 0, magicResistance: 30, magicResistancePerLevel: 0, moveSpeed: 350 },
};

function offer(key: string, flat: ResolverEffect["flat"]): ResolverEffect {
  return { key, name: key, kind: "augment", rarity: "silver", rank: 1, flat };
}

test("compares each draft option against one unchanged baseline", () => {
  const compared = compareDraftOptions({ champion, level: 1, currentEffects: [offer("owned", { abilityPower: 20 })], offeredEffects: [offer("hp", { maxHealth: 500 }), offer("ap", { abilityPower: 100 }), offer("haste", { abilityHaste: 100 })] });
  assert.equal(compared.baseline.stats.abilityPower, 20);
  assert.equal(compared.options[0].deltas.maxHealth, 500);
  assert.equal(compared.options[1].deltas.abilityPower, 100);
  assert.equal(compared.options[2].deltas.effectiveCooldownReductionPercent, 50);
});
