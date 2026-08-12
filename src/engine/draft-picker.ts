import { resolveArenaStats, type ResolveOptions, type ResolverChampion, type ResolverEffect, type ResolverResult, type ResolverStatKey } from "@/engine/resolver";

export const DRAFT_STATS = [
  "maxHealth",
  "totalAttackDamage",
  "abilityPower",
  "attackSpeed",
  "armor",
  "magicResistance",
  "moveSpeed",
  "abilityHaste",
  "effectiveCooldownReductionPercent",
] as const satisfies readonly ResolverStatKey[];

export type DraftStatKey = typeof DRAFT_STATS[number];

export type DraftOptionResult = {
  effect: ResolverEffect;
  result: ResolverResult;
  deltas: Record<DraftStatKey, number>;
  localScore: number;
};

const SCORE_CONFIG: Record<DraftStatKey, { floor: number; weight: number }> = {
  maxHealth: { floor: 1_000, weight: 1.1 },
  totalAttackDamage: { floor: 100, weight: 1.25 },
  abilityPower: { floor: 100, weight: 1.25 },
  attackSpeed: { floor: 0.6, weight: 1.15 },
  armor: { floor: 50, weight: 0.75 },
  magicResistance: { floor: 50, weight: 0.75 },
  moveSpeed: { floor: 325, weight: 0.55 },
  abilityHaste: { floor: 100, weight: 0.85 },
  effectiveCooldownReductionPercent: { floor: 50, weight: 0.45 },
};

function finiteDelta(after: number, before: number): number {
  const value = after - before;
  return Number.isFinite(value) ? value : 0;
}

export function compareDraftOptions(input: {
  champion: ResolverChampion;
  level: number;
  currentEffects: readonly ResolverEffect[];
  offeredEffects: readonly ResolverEffect[];
  options?: ResolveOptions;
}): { baseline: ResolverResult; options: DraftOptionResult[] } {
  const baseline = resolveArenaStats(input.champion, input.level, input.currentEffects, input.options);
  const options = input.offeredEffects.map((effect) => {
    const result = resolveArenaStats(input.champion, input.level, [...input.currentEffects, effect], input.options);
    const deltas = Object.fromEntries(DRAFT_STATS.map((stat) => [stat, finiteDelta(result.stats[stat], baseline.stats[stat])])) as Record<DraftStatKey, number>;
    const localScore = DRAFT_STATS.reduce((score, stat) => {
      const config = SCORE_CONFIG[stat];
      return score + (deltas[stat] / Math.max(Math.abs(baseline.stats[stat]), config.floor)) * config.weight;
    }, 0);
    return { effect, result, deltas, localScore };
  });
  return { baseline, options };
}

export function localDraftRationale(option: DraftOptionResult): string {
  const gains = DRAFT_STATS
    .filter((stat) => option.deltas[stat] > 0.001)
    .sort((left, right) => option.deltas[right] - option.deltas[left])
    .slice(0, 2)
    .map((stat) => `${stat.replaceAll(/([A-Z])/g, " $1").toLowerCase()} +${option.deltas[stat].toFixed(1)}`);
  const first = gains.length > 0
    ? `${option.effect.name} produces the strongest locally weighted resolved gain: ${gains.join(" and ")}.`
    : `${option.effect.name} has the best local fallback score, although its effect is mostly conditional rather than a universal flat stat change.`;
  return `${first} The AI key is not configured, so this recommendation uses transparent stat deltas and should be treated as a mechanical fallback.`;
}
