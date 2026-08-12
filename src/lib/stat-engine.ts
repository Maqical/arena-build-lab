import type {
  CalculationResult,
  CalculationStep,
  FormulaSelection,
  StatFormula,
  StatKey,
  StatValues,
} from "@/lib/types";

export const STAT_LABELS: Record<StatKey, string> = {
  maxHealth: "Max health",
  bonusHealth: "Bonus health",
  maxMana: "Max mana",
  baseAttackDamage: "Base attack damage",
  bonusAttackDamage: "Bonus attack damage",
  abilityPower: "Ability power",
  abilityHaste: "Ability haste",
  moveSpeed: "Move speed",
  attackSpeedPercent: "Bonus attack speed",
  critChancePercent: "Critical strike chance",
  critDamagePercent: "Critical strike damage",
  cursedPower: "Cursed power",
  onHitPhysicalDamage: "On-hit physical damage",
};

export const EMPTY_STATS: StatValues = {
  maxHealth: 0,
  bonusHealth: 0,
  maxMana: 0,
  baseAttackDamage: 0,
  bonusAttackDamage: 0,
  abilityPower: 0,
  abilityHaste: 0,
  moveSpeed: 0,
  attackSpeedPercent: 0,
  critChancePercent: 0,
  critDamagePercent: 175,
  cursedPower: 0,
  onHitPhysicalDamage: 0,
};

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function compact(value: number): string {
  return Number(value.toFixed(6)).toLocaleString();
}

function rankFor(formula: StatFormula, requestedLevel: number) {
  return formula.ranks.find((rank) => rank.level === requestedLevel) ?? formula.ranks[0];
}

export function calculateStatChain(
  input: Partial<StatValues>,
  formulas: StatFormula[],
  selections: FormulaSelection[],
): CalculationResult {
  const stats = Object.fromEntries(
    Object.entries({ ...EMPTY_STATS, ...input }).map(([key, value]) => [key, finite(Number(value))]),
  ) as StatValues;
  const steps: CalculationStep[] = [];
  const warnings: string[] = [];
  const selected = selections
    .map((selection) => ({ selection, formula: formulas.find((formula) => formula.id === selection.formulaId) }))
    .filter((entry): entry is { selection: FormulaSelection; formula: StatFormula } => Boolean(entry.formula))
    .sort((left, right) => left.formula.order - right.formula.order);

  const conversionPairs = new Set<string>();
  for (const { formula } of selected) {
    if (formula.operation !== "convert") continue;
    const reverse = `${formula.targetStat}:${formula.sourceStat}`;
    if (conversionPairs.has(reverse)) {
      warnings.push(`${formula.entityName} creates a circular conversion with another selection, so it was skipped.`);
      continue;
    }
    conversionPairs.add(`${formula.sourceStat}:${formula.targetStat}`);
  }

  const appliedPairs = new Set<string>();
  for (const { formula, selection } of selected) {
    const rank = rankFor(formula, selection.level);
    if (!rank) continue;
    const pair = `${formula.sourceStat}:${formula.targetStat}`;
    if (formula.operation === "convert" && [...appliedPairs].some((value) => value === `${formula.targetStat}:${formula.sourceStat}`)) continue;

    const sourceValue = stats[formula.sourceStat];
    let delta = 0;
    let expression = "";

    if (formula.operation === "gain" || formula.operation === "derived_damage") {
      delta = sourceValue * rank.coefficient;
      stats[formula.targetStat] += delta;
      if (formula.targetStat === "bonusHealth") stats.maxHealth += delta;
      expression = `${compact(sourceValue)} × ${compact(rank.coefficient)}`;
    } else if (formula.operation === "convert") {
      const beforeTarget = stats[formula.targetStat];
      const converted = sourceValue * rank.coefficient;
      stats[formula.sourceStat] = 0;
      const multiplierBase = formula.multiplierBaseStat ? stats[formula.multiplierBaseStat] : 0;
      stats[formula.targetStat] = (multiplierBase + beforeTarget + converted) * (rank.targetMultiplier ?? 1) - multiplierBase;
      delta = stats[formula.targetStat] - beforeTarget;
      expression = multiplierBase
        ? `(${compact(multiplierBase)} base + ${compact(beforeTarget)} bonus + ${compact(sourceValue)} × ${compact(rank.coefficient)}) × ${compact(rank.targetMultiplier ?? 1)} − ${compact(multiplierBase)} base`
        : `(${compact(beforeTarget)} + ${compact(sourceValue)} × ${compact(rank.coefficient)}) × ${compact(rank.targetMultiplier ?? 1)}`;
      appliedPairs.add(pair);
    } else {
      const chanceAfterFlatBonus = stats.critChancePercent + 25;
      const overflow = Math.max(0, chanceAfterFlatBonus - 50);
      stats.critChancePercent = Math.min(50, chanceAfterFlatBonus);
      delta = 25 + overflow * rank.coefficient;
      stats.critDamagePercent += delta;
      expression = `25 flat + ${compact(overflow)} overflow × ${compact(rank.coefficient)}`;
    }

    steps.push({
      formulaId: formula.id,
      entityName: formula.entityName,
      expression,
      sourceValue,
      delta,
      targetStat: formula.targetStat,
      resultValue: stats[formula.targetStat],
    });
  }

  return { stats, steps, warnings };
}
