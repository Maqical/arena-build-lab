import { resolveArenaStats, type ResolverChampion, type ResolverEffect, type ResolverResult, type ResolverScenario, type ResolverStatKey } from "@/engine/resolver";

export const EXTREME_OBJECTIVES = [
  "maxHealth",
  "totalAttackDamage",
  "abilityPower",
  "abilityHaste",
  "moveSpeed",
  "attackSpeed",
  "critDamagePercent",
  "onHitPhysicalDamage",
] as const satisfies readonly ResolverStatKey[];

export type ExtremeObjective = typeof EXTREME_OBJECTIVES[number];

export type AugmentSlotRules = {
  prismatic: number;
  gold: number;
  silver: number;
};

export const DEFAULT_SLOT_RULES: AugmentSlotRules = { prismatic: 1, gold: 2, silver: 1 };

export type ExtremeBuild = {
  championKey: string;
  championName: string;
  level: number;
  objective: ExtremeObjective;
  score: number;
  theoreticalUnbounded: boolean;
  unboundedReason: string;
  status: ResolverResult["status"];
  stats: ResolverResult["stats"];
  iterations: number;
  delta: number;
  effects: ResolverResult["effects"];
};

export type ExtremeFinderInput = {
  champions: ResolverChampion[];
  augments: ResolverEffect[];
  fixedEffects?: ResolverEffect[];
  level?: number;
  slotRules?: AugmentSlotRules;
  objectives?: readonly ExtremeObjective[];
  topPerChampionObjective?: number;
  scenarioForChampion?: (champion: ResolverChampion) => ResolverScenario;
};

function choose<T>(values: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (count > values.length) return [];
  const output: T[][] = [];
  function visit(start: number, selected: T[]) {
    if (selected.length === count) {
      output.push([...selected]);
      return;
    }
    for (let index = start; index <= values.length - (count - selected.length); index += 1) {
      selected.push(values[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  }
  visit(0, []);
  return output;
}

export function generateAugmentCombinations(
  augments: readonly ResolverEffect[],
  rules: AugmentSlotRules = DEFAULT_SLOT_RULES,
): ResolverEffect[][] {
  const byRarity = {
    prismatic: augments.filter((augment) => augment.rarity === "prismatic"),
    gold: augments.filter((augment) => augment.rarity === "gold"),
    silver: augments.filter((augment) => augment.rarity === "silver"),
  };
  const groups = [
    choose(byRarity.prismatic, rules.prismatic),
    choose(byRarity.gold, rules.gold),
    choose(byRarity.silver, rules.silver),
  ];
  if (groups.some((group) => group.length === 0)) return [];
  return groups[0].flatMap((prismatic) => groups[1].flatMap((gold) => groups[2].map((silver) => [...prismatic, ...gold, ...silver])));
}

function objectiveCanScaleWithoutBound(champion: ResolverChampion, objective: ExtremeObjective, effects: readonly ResolverEffect[]): string {
  if (champion.key !== "Sion" && champion.key !== "Chogath") return "";
  const edges = effects.flatMap((effect) => effect.rules ?? []);
  const reachable = new Set<ResolverStatKey>(["maxHealth", "bonusHealth"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (reachable.has(edge.source) && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        if (edge.target === "bonusAttackDamage") reachable.add("totalAttackDamage");
        changed = true;
      }
    }
  }
  if (!reachable.has(objective)) return "";
  return champion.key === "Sion"
    ? "No finite maximum: Soul Furnace can permanently gain health from an unlimited number of eligible kills."
    : "No finite maximum: Feast can permanently gain health from additional champion/epic-monster stacks.";
}

export function findExtremeBuilds(input: ExtremeFinderInput): ExtremeBuild[] {
  const level = input.level ?? 18;
  const objectives = input.objectives ?? EXTREME_OBJECTIVES;
  const keep = Math.max(1, Math.trunc(input.topPerChampionObjective ?? 100));
  const combinations = generateAugmentCombinations(input.augments, input.slotRules ?? DEFAULT_SLOT_RULES);
  if (combinations.length === 0) throw new Error("No augment combinations satisfy the configured rarity slots.");

  const output: ExtremeBuild[] = [];
  for (const champion of input.champions) {
    const perObjective = new Map<ExtremeObjective, ExtremeBuild[]>(objectives.map((objective) => [objective, []]));
    for (const augments of combinations) {
      const allEffects = [...augments, ...(input.fixedEffects ?? [])];
      const resolved = resolveArenaStats(champion, level, allEffects, { scenario: input.scenarioForChampion?.(champion) });
      for (const objective of objectives) {
        const unboundedReason = objectiveCanScaleWithoutBound(champion, objective, allEffects);
        const build: ExtremeBuild = {
          championKey: champion.key,
          championName: champion.name,
          level: resolved.level,
          objective,
          score: resolved.stats[objective],
          theoreticalUnbounded: Boolean(unboundedReason),
          unboundedReason,
          status: resolved.status,
          stats: resolved.stats,
          iterations: resolved.iterations,
          delta: resolved.delta,
          effects: resolved.effects,
        };
        const list = perObjective.get(objective) ?? [];
        list.push(build);
        list.sort((left, right) => Number(right.theoreticalUnbounded) - Number(left.theoreticalUnbounded) || right.score - left.score);
        if (list.length > keep) list.length = keep;
        perObjective.set(objective, list);
      }
    }
    for (const builds of perObjective.values()) output.push(...builds);
  }
  return output.sort((left, right) => left.championName.localeCompare(right.championName) || left.objective.localeCompare(right.objective) || right.score - left.score);
}
