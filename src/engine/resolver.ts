export type ResolverStatKey =
  | "maxHealth"
  | "bonusHealth"
  | "maxMana"
  | "baseAttackDamage"
  | "bonusAttackDamage"
  | "totalAttackDamage"
  | "abilityPower"
  | "abilityHaste"
  | "moveSpeed"
  | "bonusAttackSpeedPercent"
  | "attackSpeed"
  | "critChancePercent"
  | "uncappedCritChancePercent"
  | "critDamagePercent"
  | "cursedPower"
  | "onHitPhysicalDamage";

export type MutableResolverStatKey = Exclude<
  ResolverStatKey,
  "bonusHealth" | "baseAttackDamage" | "totalAttackDamage" | "attackSpeed" | "uncappedCritChancePercent"
>;

export type ResolverStats = Record<ResolverStatKey, number>;

export type ResolverChampion = {
  key: string;
  name: string;
  stats: {
    health: number;
    healthPerLevel: number;
    mana: number;
    manaPerLevel: number;
    attackDamage: number;
    attackDamagePerLevel: number;
    attackSpeed: number;
    attackSpeedPerLevel: number;
    moveSpeed: number;
  };
};

export type ConversionRule = {
  source: ResolverStatKey;
  target: MutableResolverStatKey;
  coefficient: number;
  sourceFloor?: number;
  mode?: "add" | "convert";
};

export type StatMultiplier = {
  stat: "maxHealth" | "bonusHealth" | "totalAttackDamage" | "abilityPower" | "abilityHaste" | "moveSpeed";
  factor: number;
};

export type ResolverEffect = {
  key: string;
  name: string;
  kind: "augment" | "item" | "scenario";
  rarity: string;
  rank: number;
  flat?: Partial<Record<MutableResolverStatKey, number>>;
  rules?: ConversionRule[];
  multipliers?: StatMultiplier[];
  attackSpeedCap?: number;
  totalAttackSpeedMultiplier?: number;
  critChanceCap?: number;
  notes?: string[];
};

export type ResolverScenario = {
  flatStats?: Partial<Record<MutableResolverStatKey, number>>;
  sionSoulFurnace?: {
    smallUnits?: number;
    largeUnits?: number;
    championKills?: number;
    healthPerSmallUnit?: number;
    healthPerLargeUnit?: number;
    healthPerChampionKill?: number;
  };
  championPermanentHealth?: number;
  attackSpeedCap?: number;
  maxMagnitude?: number;
};

export type ResolveOptions = {
  epsilon?: number;
  maxIterations?: number;
  scenario?: ResolverScenario;
};

export type ResolveStatus = "converged" | "diverged" | "unbounded" | "max_iterations";

export type ResolverResult = {
  championKey: string;
  championName: string;
  level: number;
  status: ResolveStatus;
  stats: ResolverStats;
  iterations: number;
  delta: number;
  attackSpeedCap: number;
  effects: Array<{ key: string; name: string; kind: ResolverEffect["kind"]; rank: number; rarity: string }>;
  warnings: string[];
  unboundedReasons: string[];
};

const MUTABLE_KEYS: MutableResolverStatKey[] = [
  "maxHealth",
  "maxMana",
  "bonusAttackDamage",
  "abilityPower",
  "abilityHaste",
  "moveSpeed",
  "bonusAttackSpeedPercent",
  "critChancePercent",
  "critDamagePercent",
  "cursedPower",
  "onHitPhysicalDamage",
];

const COMPARED_KEYS: ResolverStatKey[] = [
  "maxHealth",
  "bonusHealth",
  "maxMana",
  "bonusAttackDamage",
  "totalAttackDamage",
  "abilityPower",
  "abilityHaste",
  "moveSpeed",
  "bonusAttackSpeedPercent",
  "attackSpeed",
  "critChancePercent",
  "uncappedCritChancePercent",
  "critDamagePercent",
  "cursedPower",
  "onHitPhysicalDamage",
];

function clampLevel(level: number): number {
  return Math.min(Math.max(Math.trunc(level), 1), 30);
}

function finiteOrZero(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function derivedStats(
  mutable: Record<MutableResolverStatKey, number>,
  baseHealth: number,
  baseAttackDamage: number,
  baseAttackSpeed: number,
  totalAttackSpeedMultiplier: number,
  attackSpeedCap: number,
  critChanceCap: number,
): ResolverStats {
  const maxHealth = Math.max(1, mutable.maxHealth);
  const totalAttackDamage = Math.max(0, baseAttackDamage + mutable.bonusAttackDamage);
  return {
    ...mutable,
    maxHealth,
    bonusHealth: Math.max(0, maxHealth - baseHealth),
    baseAttackDamage,
    totalAttackDamage,
    attackSpeed: Math.min(
      attackSpeedCap,
      Math.max(0, baseAttackSpeed * (1 + mutable.bonusAttackSpeedPercent / 100) * totalAttackSpeedMultiplier),
    ),
    uncappedCritChancePercent: Math.max(0, mutable.critChancePercent),
    critChancePercent: Math.min(critChanceCap, Math.max(0, mutable.critChancePercent)),
    critDamagePercent: Math.max(0, mutable.critDamagePercent),
  };
}

function maxDelta(left: ResolverStats, right: ResolverStats): number {
  return Math.max(...COMPARED_KEYS.map((key) => Math.abs(left[key] - right[key])));
}

function containsInfinity(values: unknown[]): boolean {
  return values.some((value) => Number(value) === Number.POSITIVE_INFINITY);
}

/**
 * Resolves a champion and a collection of already-hydrated Arena effects.
 *
 * Each pass rebuilds stats from the immutable seed plus conversions evaluated
 * against the previous pass. This computes x = b + F(x) without accidentally
 * adding the same conversion repeatedly. Cycles that do not contract are
 * returned as divergent/unbounded rather than disguised as a finite result.
 */
export function resolveArenaStats(
  champion: ResolverChampion,
  level: number,
  effects: readonly ResolverEffect[],
  options: ResolveOptions = {},
): ResolverResult {
  const resolvedLevel = clampLevel(level);
  const epsilon = Math.max(options.epsilon ?? 1e-7, Number.EPSILON);
  const maxIterations = Math.max(2, Math.trunc(options.maxIterations ?? 250));
  const scenario = options.scenario ?? {};
  const maxMagnitude = Math.max(1, scenario.maxMagnitude ?? 1e12);
  const warnings: string[] = [];
  const unboundedReasons: string[] = [];

  const sion = scenario.sionSoulFurnace ?? {};
  if (champion.key === "Sion" && containsInfinity([sion.smallUnits, sion.largeUnits, sion.championKills])) {
    unboundedReasons.push("Sion's Soul Furnace permanent-health input has no finite stack limit.");
  }
  if (Number(scenario.championPermanentHealth) === Number.POSITIVE_INFINITY) {
    unboundedReasons.push(`${champion.name}'s permanent-health input was declared unlimited.`);
  }

  const baseHealth = champion.stats.health + champion.stats.healthPerLevel * (resolvedLevel - 1);
  const baseAttackDamage = champion.stats.attackDamage + champion.stats.attackDamagePerLevel * (resolvedLevel - 1);
  const baseAttackSpeed = champion.stats.attackSpeed;
  const levelAttackSpeed = champion.stats.attackSpeedPerLevel * (resolvedLevel - 1);
  const seed = {
    maxHealth: baseHealth,
    maxMana: champion.stats.mana + champion.stats.manaPerLevel * (resolvedLevel - 1),
    bonusAttackDamage: 0,
    abilityPower: 0,
    abilityHaste: 0,
    moveSpeed: champion.stats.moveSpeed,
    bonusAttackSpeedPercent: levelAttackSpeed,
    critChancePercent: 0,
    critDamagePercent: 175,
    cursedPower: 0,
    onHitPhysicalDamage: 0,
  } satisfies Record<MutableResolverStatKey, number>;

  for (const [key, value] of Object.entries(scenario.flatStats ?? {})) {
    seed[key as MutableResolverStatKey] += finiteOrZero(value);
  }
  if (champion.key === "Sion" && unboundedReasons.length === 0) {
    seed.maxHealth +=
      finiteOrZero(sion.smallUnits) * finiteOrZero(sion.healthPerSmallUnit ?? 4) +
      finiteOrZero(sion.largeUnits) * finiteOrZero(sion.healthPerLargeUnit ?? 15) +
      finiteOrZero(sion.championKills) * finiteOrZero(sion.healthPerChampionKill ?? 15);
  }
  seed.maxHealth += finiteOrZero(scenario.championPermanentHealth);

  for (const effect of effects) {
    for (const [key, value] of Object.entries(effect.flat ?? {})) {
      seed[key as MutableResolverStatKey] += finiteOrZero(value);
    }
  }

  const totalAttackSpeedMultiplier = effects.reduce((product, effect) => product * (effect.totalAttackSpeedMultiplier ?? 1), 1);
  const attackSpeedCap = Math.max(scenario.attackSpeedCap ?? 2.5, ...effects.map((effect) => effect.attackSpeedCap ?? 0));
  const critChanceCap = Math.min(100, ...effects.map((effect) => effect.critChanceCap ?? 100));
  const effectSummary = effects.map(({ key, name, kind, rank, rarity }) => ({ key, name, kind, rank, rarity }));
  const convertedSources = new Set(
    effects.flatMap((effect) => (effect.rules ?? [])
      .filter((rule) => rule.mode === "convert" && MUTABLE_KEYS.includes(rule.source as MutableResolverStatKey))
      .map((rule) => rule.source as MutableResolverStatKey)),
  );
  const present = (stats: ResolverStats): ResolverStats => {
    if (convertedSources.size === 0) return stats;
    const mutable = { ...seed };
    for (const key of MUTABLE_KEYS) mutable[key] = stats[key];
    for (const source of convertedSources) mutable[source] = 0;
    return derivedStats(mutable, baseHealth, baseAttackDamage, baseAttackSpeed, totalAttackSpeedMultiplier, attackSpeedCap, critChanceCap);
  };

  if (unboundedReasons.length > 0) {
    const stats = derivedStats(seed, baseHealth, baseAttackDamage, baseAttackSpeed, totalAttackSpeedMultiplier, attackSpeedCap, critChanceCap);
    stats.maxHealth = Number.POSITIVE_INFINITY;
    stats.bonusHealth = Number.POSITIVE_INFINITY;
    return { championKey: champion.key, championName: champion.name, level: resolvedLevel, status: "unbounded", stats, iterations: 0, delta: Number.POSITIVE_INFINITY, attackSpeedCap, effects: effectSummary, warnings, unboundedReasons };
  }

  let current = derivedStats(seed, baseHealth, baseAttackDamage, baseAttackSpeed, totalAttackSpeedMultiplier, attackSpeedCap, critChanceCap);
  let delta = Number.POSITIVE_INFINITY;
  let initialDelta = 0;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const nextMutable = { ...seed };
    for (const effect of effects) {
      for (const rule of effect.rules ?? []) {
        nextMutable[rule.target] += Math.max(0, current[rule.source] - (rule.sourceFloor ?? 0)) * rule.coefficient;
      }
    }

    for (const effect of effects) {
      for (const multiplier of effect.multipliers ?? []) {
        if (multiplier.stat === "maxHealth") nextMutable.maxHealth *= multiplier.factor;
        else if (multiplier.stat === "bonusHealth") nextMutable.maxHealth = baseHealth + Math.max(0, nextMutable.maxHealth - baseHealth) * multiplier.factor;
        else if (multiplier.stat === "totalAttackDamage") nextMutable.bonusAttackDamage = (baseAttackDamage + nextMutable.bonusAttackDamage) * multiplier.factor - baseAttackDamage;
        else nextMutable[multiplier.stat] *= multiplier.factor;
      }
    }

    const next = derivedStats(nextMutable, baseHealth, baseAttackDamage, baseAttackSpeed, totalAttackSpeedMultiplier, attackSpeedCap, critChanceCap);
    delta = maxDelta(current, next);
    if (iteration === 1) initialDelta = delta;
    const magnitude = Math.max(...COMPARED_KEYS.map((key) => Math.abs(next[key])));
    if (!Number.isFinite(delta) || !Number.isFinite(magnitude) || magnitude > maxMagnitude) {
      warnings.push("The conversion graph exceeded the configured magnitude guard.");
      return { championKey: champion.key, championName: champion.name, level: resolvedLevel, status: "diverged", stats: present(next), iterations: iteration, delta, attackSpeedCap, effects: effectSummary, warnings, unboundedReasons };
    }
    current = next;
    if (delta < epsilon) {
      return { championKey: champion.key, championName: champion.name, level: resolvedLevel, status: "converged", stats: present(current), iterations: iteration, delta, attackSpeedCap, effects: effectSummary, warnings, unboundedReasons };
    }
  }

  const status: ResolveStatus = delta >= initialDelta * 0.5 ? "diverged" : "max_iterations";
  warnings.push(status === "diverged"
    ? "The conversion graph does not contract toward a finite fixed point."
    : "The conversion graph approached a fixed point but exhausted the iteration budget.");
  return { championKey: champion.key, championName: champion.name, level: resolvedLevel, status, stats: present(current), iterations: maxIterations, delta, attackSpeedCap, effects: effectSummary, warnings, unboundedReasons };
}
