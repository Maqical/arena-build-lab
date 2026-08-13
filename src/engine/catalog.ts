import type { DatabaseSync } from "node:sqlite";
import type { ResolverChampion, ResolverEffect } from "@/engine/resolver";

type Row = Record<string, unknown>;
type RawArenaEntity = {
  dataValues?: Record<string, unknown>;
  stats?: Record<string, unknown>;
};

export type HydratedResolverEntity = {
  entityKey: string;
  name: string;
  kind: "augment" | "item";
  rarity: string;
  description: string;
  iconUrl: string;
  effect: ResolverEffect;
  executable: boolean;
};

export type ExtremeScenarioInputs = {
  takedowns: number;
  cursedPower: number;
  heartsteelStacks: number;
  phenomenalEvilProcs: number;
  phenomenalEvilLatePick: boolean;
};

export const DEFAULT_EXTREME_SCENARIO: ExtremeScenarioInputs = {
  takedowns: 24,
  cursedPower: 500,
  heartsteelStacks: 4000,
  phenomenalEvilProcs: 100,
  phenomenalEvilLatePick: true,
};

const SUPPORTED_AUGMENTS = [
  "Mind to Matter",
  "ADAPt",
  "escAPADe",
  "Heavy Hitter",
  "Deft",
  "The Brutalizer",
  "Aim for the Head",
  "With Haste",
  "Recursion",
  "Celestial Body",
  "It's Critical",
  "Vulnerability",
  "Critical Healing",
  "Lightning Strikes",
  "Tank Engine",
  "Quest: Steel Your Heart",
  "Phenomenal Evil",
  "Dreadbringer",
  "Eureka",
  "Tap Dancer",
  "Goliath",
  "Chauffeur",
  "Dual Wield",
  "Bread Sandwich",
  "Dark Blessing",
  "Deathtouch",
] as const;

function rawEntity(row: Row): RawArenaEntity {
  return JSON.parse(String(row.raw_json ?? "{}")) as RawArenaEntity;
}

function rankCount(raw: RawArenaEntity): number {
  const values = raw.dataValues?.MaxLevel;
  return Array.isArray(values) ? Math.max(1, Number(values[0] ?? 1)) : 1;
}

function rankValue(raw: RawArenaEntity, key: string, rank: number, fallback = 0): number {
  const values = raw.dataValues?.[key];
  if (!Array.isArray(values)) return fallback;
  const index = Math.min(Math.max(rank, 1), rankCount(raw));
  const value = Number(values[index] ?? values[0] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function effectFromRow(row: Row, scenario: ExtremeScenarioInputs): ResolverEffect | null {
  const raw = rawEntity(row);
  const rank = rankCount(raw);
  const base = {
    key: String(row.entity_key),
    name: String(row.name),
    kind: "augment" as const,
    rarity: String(row.rarity),
    rank,
  };

  switch (base.name) {
    case "Mind to Matter":
      return { ...base, rules: [{ source: "maxMana", target: "maxHealth", coefficient: 0.5 * rankValue(raw, "Modifier", rank) }], notes: ["Raw ManaToHealth calculation: mana × 0.5 × Modifier."] };
    case "ADAPt":
      return { ...base, rules: [{ source: "bonusAttackDamage", target: "abilityPower", coefficient: rankValue(raw, "ConversionRate", rank), mode: "convert" }], multipliers: [{ stat: "abilityPower", factor: 1 + rankValue(raw, "APAmp", rank) }] };
    case "escAPADe":
      return { ...base, rules: [{ source: "abilityPower", target: "bonusAttackDamage", coefficient: rankValue(raw, "ConversionRate", rank), mode: "convert" }], multipliers: [{ stat: "totalAttackDamage", factor: 1 + rankValue(raw, "ADAmp", rank) }] };
    case "Heavy Hitter":
      return { ...base, rules: [{ source: "maxHealth", target: "onHitPhysicalDamage", coefficient: rankValue(raw, "HealthPercent", rank) }] };
    case "Deft":
      return { ...base, flat: { bonusAttackSpeedPercent: rankValue(raw, "AttackSpeed", rank) * 100 } };
    case "The Brutalizer":
      return { ...base, flat: { bonusAttackDamage: rankValue(raw, "AD", rank), abilityHaste: rankValue(raw, "AbilityHaste", rank) } };
    case "Aim for the Head":
      return {
        ...base,
        flat: { critChancePercent: rankValue(raw, "CritChanceBonus", rank) * 100, critDamagePercent: rankValue(raw, "CritDamageBonus", rank) * 100 },
        rules: [{ source: "uncappedCritChancePercent", sourceFloor: rankValue(raw, "CritChanceCeiling", rank) * 100, target: "critDamagePercent", coefficient: rankValue(raw, "CritChanceToDamageRatio", rank) }],
        critChanceCap: rankValue(raw, "CritChanceCeiling", rank) * 100,
      };
    case "With Haste":
      return { ...base, rules: [{ source: "abilityHaste", target: "moveSpeed", coefficient: rankValue(raw, "AbilityHasteToMSConversion", rank) }] };
    case "Recursion":
      return { ...base, flat: { abilityHaste: rankValue(raw, "AbilityHaste", rank) } };
    case "Celestial Body":
      return { ...base, flat: { maxHealth: rankValue(raw, "Health", rank) } };
    case "It's Critical":
      return { ...base, flat: { critChancePercent: rankValue(raw, "CritChance", rank) * 100 }, notes: ["CritDamageMultiplier is retained as conditional metadata and is not folded into the universal crit-damage stat."] };
    case "Vulnerability":
    case "Critical Healing":
      return { ...base, flat: { critChancePercent: rankValue(raw, "CritChance", rank) * 100 } };
    case "Lightning Strikes":
      return { ...base, totalAttackSpeedMultiplier: 1 + rankValue(raw, "TotalASValue", rank), attackSpeedCap: rankValue(raw, "AttackSpeedCap", rank) };
    case "Tank Engine":
      return { ...base, multipliers: [{ stat: "bonusHealth", factor: 1 + rankValue(raw, "MaxHPIncrement", rank) * scenario.takedowns }], notes: [`Benchmark assumes ${scenario.takedowns} takedowns.`] };
    case "Quest: Steel Your Heart": {
      const multiplier = rankValue(raw, "StackMultiplication", rank, 3);
      const threshold = rankValue(raw, "StackThreshold", rank, 400);
      return {
        ...base,
        flat: { maxHealth: scenario.heartsteelStacks >= threshold ? scenario.heartsteelStacks * (multiplier - 1) : 0 },
        notes: [`Benchmark starts from ${scenario.heartsteelStacks} pre-quest Heartsteel stacks.`],
      };
    }
    case "Phenomenal Evil":
      return {
        ...base,
        flat: {
          abilityPower: rankValue(raw, "APPerProc", rank) * scenario.phenomenalEvilProcs +
            (scenario.phenomenalEvilLatePick ? rankValue(raw, "BonusAPForLatePick", rank) : 0),
        },
        notes: [`Benchmark assumes ${scenario.phenomenalEvilProcs} procs.`],
      };
    case "Dreadbringer":
      return { ...base, rules: [{ source: "cursedPower", target: "maxHealth", coefficient: rankValue(raw, "MaxHealthRatio", rank) }], notes: [`Benchmark assumes ${scenario.cursedPower} Cursed Power.`] };
    case "Eureka":
      return { ...base, rules: [{ source: "abilityPower", target: "abilityHaste", coefficient: rankValue(raw, "APToHasteConversion", rank) }] };
    case "Tap Dancer":
      return { ...base, rules: [{ source: "moveSpeed", target: "bonusAttackSpeedPercent", coefficient: rankValue(raw, "MSToASConversion", rank) * 100 }] };
    case "Goliath":
      return {
        ...base,
        multipliers: [
          { stat: "maxHealth", factor: 1 + rankValue(raw, "HealthAmp", rank) },
          { stat: "totalAttackDamage", factor: 1 + rankValue(raw, "ADAmp", rank) },
          { stat: "abilityPower", factor: 1 + rankValue(raw, "APAmp", rank) },
        ],
      };
    case "Chauffeur":
      return { ...base, flat: { abilityHaste: rankValue(raw, "Haste", rank), bonusAttackSpeedPercent: rankValue(raw, "AttackSpeed", rank) * 100 } };
    case "Dual Wield":
      return { ...base, totalAttackSpeedMultiplier: 1 + rankValue(raw, "AttackSpeed", rank), attackSpeedCap: rankValue(raw, "MaxAttackSpeedCap", rank) };
    case "Bread Sandwich":
      return { ...base, flat: { abilityHaste: rankValue(raw, "AbilityHaste", rank) }, multipliers: [{ stat: "moveSpeed", factor: 1 + rankValue(raw, "MoveSpeedAmp", rank) }], notes: ["Move-speed amplifier is evaluated in its active post-cast state."] };
    case "Dark Blessing":
      return { ...base, rules: [{ source: "cursedPower", target: "abilityHaste", coefficient: rankValue(raw, "AbilityHasteRatio", rank) }], notes: [`Benchmark assumes ${scenario.cursedPower} Cursed Power.`] };
    case "Deathtouch":
      return { ...base, rules: [{ source: "cursedPower", target: "bonusAttackSpeedPercent", coefficient: rankValue(raw, "AttackSpeedRatio", rank) * 100 }], notes: [`Benchmark assumes ${scenario.cursedPower} Cursed Power.`] };
    default:
      return null;
  }
}

function itemEffectFromRow(row: Row): ResolverEffect {
  const raw = rawEntity(row);
  const stats = raw.stats ?? {};
  const description = String(row.description ?? "");
  const number = (key: string) => {
    const value = Number(stats[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const haste = Number(description.match(/([\d.]+)\s+Ability Haste/i)?.[1] ?? 0);
  const flat: NonNullable<ResolverEffect["flat"]> = {
    maxHealth: number("FlatHPPoolMod"),
    maxMana: number("FlatMPPoolMod"),
    bonusAttackDamage: number("FlatPhysicalDamageMod"),
    abilityPower: number("FlatMagicDamageMod"),
    abilityHaste: Number.isFinite(haste) ? haste : 0,
    armor: number("FlatArmorMod"),
    magicResistance: number("FlatSpellBlockMod"),
    moveSpeed: number("FlatMovementSpeedMod"),
    bonusAttackSpeedPercent: number("PercentAttackSpeedMod") * 100,
    critChancePercent: number("FlatCritChanceMod") * 100,
  };
  const effect: ResolverEffect = {
    key: String(row.entity_key),
    name: String(row.name),
    kind: "item",
    rarity: String(row.rarity),
    rank: 1,
    flat,
  };
  if (effect.name === "Overlord's Bloodmail") {
    effect.rules = [{ source: "bonusHealth", target: "bonusAttackDamage", coefficient: 0.03 }];
    effect.multipliers = [{ stat: "totalAttackDamage", factor: 1.175 }];
    effect.notes = ["Retribution is evaluated at its stated maximum 17.5% AD increase."];
  } else if (effect.name === "Rabadon's Deathcap") {
    effect.multipliers = [{ stat: "abilityPower", factor: 1.3 }];
  }
  const moveSpeedMultiplier = number("PercentMovementSpeedMod");
  if (moveSpeedMultiplier) {
    effect.multipliers = [...(effect.multipliers ?? []), { stat: "moveSpeed", factor: 1 + moveSpeedMultiplier }];
  }
  return effect;
}

export function loadResolverChampion(db: DatabaseSync, championKeyOrName: string): ResolverChampion | null {
  const row = db.prepare(`
    SELECT id, champion_key, name, stats_json FROM champions
    WHERE CAST(id AS TEXT) = ? OR lower(champion_key) = lower(?) OR lower(name) = lower(?) LIMIT 1
  `).get(championKeyOrName, championKeyOrName, championKeyOrName) as Row | undefined;
  if (!row) return null;
  const raw = JSON.parse(String(row.stats_json)) as Record<string, unknown>;
  const number = (key: string) => Number(raw[key] ?? 0);
  return {
    id: Number(row.id),
    key: String(row.champion_key),
    name: String(row.name),
    stats: {
      health: number("hp"),
      healthPerLevel: number("hpperlevel"),
      mana: number("mp"),
      manaPerLevel: number("mpperlevel"),
      attackDamage: number("attackdamage"),
      attackDamagePerLevel: number("attackdamageperlevel"),
      attackSpeed: number("attackspeed"),
      attackSpeedPerLevel: number("attackspeedperlevel"),
      armor: number("armor"),
      armorPerLevel: number("armorperlevel"),
      magicResistance: number("spellblock"),
      magicResistancePerLevel: number("spellblockperlevel"),
      moveSpeed: number("movespeed"),
    },
  };
}

export function loadExtremeAugments(
  db: DatabaseSync,
  scenario: ExtremeScenarioInputs = DEFAULT_EXTREME_SCENARIO,
): ResolverEffect[] {
  const select = db.prepare(`
    SELECT entity_key, name, rarity, raw_json FROM entities
    WHERE kind = 'augment' AND lower(name) = lower(?)
    ORDER BY CASE WHEN numeric_id < 1000 THEN 0 ELSE 1 END, numeric_id DESC LIMIT 1
  `);
  return SUPPORTED_AUGMENTS.flatMap((name) => {
    const row = select.get(name) as Row | undefined;
    if (!row) return [];
    const effect = effectFromRow(row, scenario);
    return effect ? [effect] : [];
  });
}

export function loadExtremeItems(db: DatabaseSync): ResolverEffect[] {
  const row = db.prepare(`
    SELECT entity_key, name, rarity, description, raw_json FROM entities
    WHERE kind = 'item' AND lower(name) = lower(?)
    ORDER BY purchasable DESC, numeric_id DESC LIMIT 1
  `).get("Overlord's Bloodmail") as Row | undefined;
  if (!row) return [];
  return [itemEffectFromRow(row)];
}

export function loadResolverEntity(
  db: DatabaseSync,
  entityKey: string,
  scenario: ExtremeScenarioInputs = DEFAULT_EXTREME_SCENARIO,
): HydratedResolverEntity | null {
  const row = db.prepare(`
    SELECT entity_key, kind, name, rarity, description, icon_url, raw_json
    FROM entities WHERE entity_key = ? LIMIT 1
  `).get(entityKey) as Row | undefined;
  if (!row) return null;
  const kind = String(row.kind) as HydratedResolverEntity["kind"];
  const executable = kind === "item" || effectFromRow(row, scenario) !== null;
  const effect = kind === "item"
    ? itemEffectFromRow(row)
    : effectFromRow(row, scenario) ?? {
      key: String(row.entity_key),
      name: String(row.name),
      kind: "augment",
      rarity: String(row.rarity),
      rank: 1,
      notes: ["This conditional augment is described to the AI but does not yet have a universal numeric resolver rule."],
    };
  return {
    entityKey: String(row.entity_key),
    name: String(row.name),
    kind,
    rarity: String(row.rarity),
    description: String(row.description ?? ""),
    iconUrl: String(row.icon_url ?? ""),
    effect,
    executable,
  };
}
