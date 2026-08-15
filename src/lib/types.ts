export type EntityKind = "augment" | "item";

export type CatalogEntity = {
  entityKey: string;
  kind: EntityKind;
  numericId: number;
  apiName: string;
  name: string;
  rarity: string;
  description: string;
  tooltip: string;
  iconUrl: string;
  purchasable: boolean;
  price: number;
  tags: string[];
  produces: string[];
  consumes: string[];
  patch: string;
  sourceUrl: string;
};

export type Combo = {
  slug: string;
  title: string;
  summary: string;
  entityKeys: string[];
  championTags: string[];
  goalTags: string[];
  score: number;
  evidenceUrl: string;
  evidenceUrls: string[];
  evidenceNote: string;
  patch: string;
  generated: boolean;
  origin: "curated" | "video" | "generated";
  entities: Pick<CatalogEntity, "entityKey" | "name" | "iconUrl" | "rarity" | "kind">[];
};

export type EntityOption = Pick<CatalogEntity, "entityKey" | "name" | "kind" | "iconUrl" | "rarity">;

export type Champion = {
  id: number;
  key: string;
  name: string;
  title: string;
  partype: string;
  tags: string[];
  iconUrl: string;
  stats: {
    health: number;
    healthPerLevel: number;
    mana: number;
    manaPerLevel: number;
    attackDamage: number;
    attackDamagePerLevel: number;
    moveSpeed: number;
  };
};

export type StatKey =
  | "maxHealth"
  | "bonusHealth"
  | "maxMana"
  | "baseAttackDamage"
  | "bonusAttackDamage"
  | "abilityPower"
  | "abilityHaste"
  | "moveSpeed"
  | "attackSpeedPercent"
  | "critChancePercent"
  | "critDamagePercent"
  | "cursedPower"
  | "onHitPhysicalDamage";

export type StatValues = Record<StatKey, number>;

export type FormulaRank = {
  level: number;
  coefficient: number;
  targetMultiplier?: number;
};

export type StatFormula = {
  id: string;
  entityKey: string;
  entityName: string;
  iconUrl: string;
  patch: string;
  sourceUrl: string;
  sourceStat: StatKey;
  targetStat: StatKey;
  operation: "gain" | "convert" | "overflow_crit" | "derived_damage";
  ranks: FormulaRank[];
  description: string;
  formulaText: string;
  confidence: "exact" | "conditional";
  multiplierBaseStat?: StatKey;
  order: number;
};

export type FormulaSelection = { formulaId: string; level: number };

export type CalculationStep = {
  formulaId: string;
  entityName: string;
  expression: string;
  sourceValue: number;
  delta: number;
  targetStat: StatKey;
  resultValue: number;
};

export type CalculationResult = {
  stats: StatValues;
  steps: CalculationStep[];
  warnings: string[];
};

export type PersonalRunEntity = EntityOption & { pickOrder: number };

export type PersonalRun = {
  id: number;
  playedAt: string;
  patch: string;
  champion: Pick<Champion, "id" | "key" | "name" | "iconUrl">;
  placement: number;
  teamCount: number;
  notes: string;
  source: "manual" | "riot" | "client";
  entities: PersonalRunEntity[];
};

export type PersonalEntityPerformance = {
  entityKey: string;
  name: string;
  kind: EntityKind;
  iconUrl: string;
  games: number;
  wins: number;
  winRate: number;
  topHalfRate: number;
  averagePlacement: number;
};

export type PersonalStats = {
  totalRuns: number;
  wins: number;
  winRate: number;
  topHalfRate: number;
  averagePlacement: number;
  entityPerformance: PersonalEntityPerformance[];
};

export type Video = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  url: string;
  thumbnailUrl: string;
  transcriptStatus: string;
  mentions: string[];
  mentionDetails: Array<{
    entityName: string;
    source: string;
    timestampSeconds: number | null;
    evidenceText: string;
    confidence: number;
  }>;
};

export type VideoStatClaim = {
  videoId: string;
  championKey: string;
  statKey: string;
  statLabel: string;
  value: number;
  unit: string;
  evidenceText: string;
  source: string;
  confidence: number;
  title: string;
  url: string;
  publishedAt: string;
};
