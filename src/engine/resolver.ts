export type ResolverStatKey =
  | "maxHealth"
  | "bonusHealth"
  | "maxMana"
  | "baseAttackDamage"
  | "bonusAttackDamage"
  | "totalAttackDamage"
  | "abilityPower"
  | "abilityHaste"
  | "effectiveCooldownReductionPercent"
  | "armor"
  | "magicResistance"
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
  "bonusHealth" | "baseAttackDamage" | "totalAttackDamage" | "attackSpeed" | "uncappedCritChancePercent" | "effectiveCooldownReductionPercent"
>;

export type ResolverStats = Record<ResolverStatKey, number>;

export type ResolverChampion = {
  id?: number;
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
    armor: number;
    armorPerLevel: number;
    magicResistance: number;
    magicResistancePerLevel: number;
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
  onDiagnostic?: (message: string) => void;
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

export type ResolverCatalog = {
  champions: readonly ResolverChampion[];
  effects: readonly ResolverEffect[];
};

export type ResolverIdRequest = {
  championId: number | string;
  level: number;
  augmentIds: readonly string[];
  itemIds?: readonly string[];
  catalog: ResolverCatalog;
  options?: ResolveOptions;
};

const MUTABLE_KEYS: MutableResolverStatKey[] = [
  "maxHealth",
  "maxMana",
  "bonusAttackDamage",
  "abilityPower",
  "abilityHaste",
  "armor",
  "magicResistance",
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
  "effectiveCooldownReductionPercent",
  "armor",
  "magicResistance",
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
    effectiveCooldownReductionPercent: 100 * Math.max(0, mutable.abilityHaste) / (100 + Math.max(0, mutable.abilityHaste)),
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
    armor: champion.stats.armor + champion.stats.armorPerLevel * (resolvedLevel - 1),
    magicResistance: champion.stats.magicResistance + champion.stats.magicResistancePerLevel * (resolvedLevel - 1),
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

/**
 * ID-based facade for callers that already hold an in-memory catalog.
 * Database access stays outside the resolver, so identical inputs always
 * produce identical output and this function remains safe for tests/workers.
 */
export function resolveArenaBuild(request: ResolverIdRequest): ResolverResult {
  const championId = String(request.championId).toLowerCase();
  const champion = request.catalog.champions.find((candidate) =>
    String(candidate.id ?? "").toLowerCase() === championId ||
    candidate.key.toLowerCase() === championId ||
    candidate.name.toLowerCase() === championId,
  );
  if (!champion) throw new Error(`Unknown champion ID: ${request.championId}`);

  const effectsById = new Map<string, ResolverEffect>();
  for (const effect of request.catalog.effects) {
    const key = effect.key.toLowerCase();
    effectsById.set(key, effect);
    const numeric = key.match(/^(?:augment|item):(\d+)$/)?.[1];
    if (numeric) effectsById.set(numeric, effect);
  }
  const effects: ResolverEffect[] = [];
  const diagnostics: string[] = [];
  const diagnostic = request.options?.onDiagnostic ?? ((message: string) => console.warn(message));
  for (const id of request.augmentIds) {
    const normalized = String(id).toLowerCase();
    const effect = effectsById.get(normalized) ?? effectsById.get(`augment:${normalized}`);
    if (effect) effects.push(effect);
    else {
      const message = `Ignored uncatalogued selection ID: ${String(id).replace(/^augment:/i, "")}`;
      diagnostics.push(message);
      diagnostic(message);
    }
  }
  for (const id of request.itemIds ?? []) {
    const normalized = String(id).toLowerCase();
    const effect = effectsById.get(normalized) ?? effectsById.get(`item:${normalized}`);
    if (!effect) throw new Error(`Unknown Arena item ID: ${id}`);
    effects.push(effect);
  }
  const result = resolveArenaStats(champion, request.level, effects, request.options);
  return diagnostics.length === 0 ? result : { ...result, warnings: [...diagnostics, ...result.warnings] };
}
