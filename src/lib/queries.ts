import "server-only";

import { getDatabase, jsonArray } from "@/lib/db";
import { normalizedSelectionKey, selectionNumericId, uncataloguedSelectionLabel } from "@/lib/selection-label";
import type { CatalogEntity, Champion, Combo, EntityKind, EntityOption, StatFormula, StatKey, Video } from "@/lib/types";

type EntityRow = Record<string, unknown>;

export function mapEntity(row: EntityRow): CatalogEntity {
  return {
    entityKey: String(row.entity_key),
    kind: String(row.kind) as EntityKind,
    numericId: Number(row.numeric_id),
    apiName: String(row.api_name ?? ""),
    name: String(row.name),
    rarity: String(row.rarity),
    description: String(row.description ?? ""),
    tooltip: String(row.tooltip ?? ""),
    iconUrl: String(row.icon_url ?? ""),
    purchasable: Boolean(row.purchasable),
    price: Number(row.price ?? 0),
    tags: jsonArray(row.tags_json),
    produces: jsonArray(row.produces_json),
    consumes: jsonArray(row.consumes_json),
    patch: String(row.patch),
    sourceUrl: String(row.source_url),
  };
}

export function getOverview() {
  const db = getDatabase();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM champions) AS champions,
      (SELECT COUNT(*) FROM entities WHERE kind='augment') AS augments,
      (SELECT COUNT(*) FROM entities WHERE kind='item') AS items,
      (SELECT COUNT(*) FROM combos WHERE origin='curated') AS curatedCombos,
      (SELECT COUNT(*) FROM combos WHERE origin='video') AS videoCombos,
      (SELECT COUNT(*) FROM combos WHERE origin='generated') AS discoveredCombos,
      (SELECT COUNT(*) FROM videos) AS videos,
      (SELECT COUNT(*) FROM video_mentions) AS mentions
  `).get() as {
    champions: number;
    augments: number;
    items: number;
    curatedCombos: number;
    videoCombos: number;
    discoveredCombos: number;
    videos: number;
    mentions: number;
  };
  const metadata = Object.fromEntries(
    (db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]),
  );
  return { ...counts, patch: metadata.patch ?? "not synced", lastSync: metadata.last_static_sync ?? "" };
}

export function getChampions(): Champion[] {
  return (getDatabase().prepare("SELECT * FROM champions ORDER BY name").all() as EntityRow[]).map((row) => {
    const rawStats = JSON.parse(String(row.stats_json ?? "{}")) as Record<string, unknown>;
    const stat = (key: string) => Number(rawStats[key] ?? 0);
    return {
      id: Number(row.id),
      key: String(row.champion_key),
      name: String(row.name),
      title: String(row.title),
      partype: String(row.partype),
      tags: jsonArray(row.tags_json),
      iconUrl: String(row.icon_url),
      stats: {
        health: stat("hp"),
        healthPerLevel: stat("hpperlevel"),
        mana: stat("mp"),
        manaPerLevel: stat("mpperlevel"),
        attackDamage: stat("attackdamage"),
        attackDamagePerLevel: stat("attackdamageperlevel"),
        moveSpeed: stat("movespeed"),
      },
    };
  });
}

type FormulaSpec = {
  name: string;
  kind: EntityKind;
  sourceStat: StatKey;
  targetStat: StatKey;
  operation: StatFormula["operation"];
  coefficientKey?: string;
  coefficientScale?: number;
  fixedCoefficient?: number;
  multiplierKey?: string;
  calculationCoefficient?: number;
  description: string;
  formulaText: string;
  confidence: StatFormula["confidence"];
  multiplierBaseStat?: StatKey;
  order: number;
};

const FORMULA_SPECS: FormulaSpec[] = [
  { name: "Mind to Matter", kind: "augment", sourceStat: "maxMana", targetStat: "bonusHealth", operation: "gain", coefficientKey: "Modifier", calculationCoefficient: 0.5, description: "Turns max mana into bonus max health.", formulaText: "Max mana × 0.5 × current Modifier", confidence: "exact", order: 10 },
  { name: "Dreadbringer", kind: "augment", sourceStat: "cursedPower", targetStat: "bonusHealth", operation: "gain", coefficientKey: "MaxHealthRatio", description: "Adds max health for every point of Cursed Power.", formulaText: "Cursed Power × MaxHealthRatio", confidence: "exact", order: 11 },
  { name: "ADAPt", kind: "augment", sourceStat: "bonusAttackDamage", targetStat: "abilityPower", operation: "convert", coefficientKey: "ConversionRate", multiplierKey: "APAmp", description: "Converts bonus AD into AP, then applies its AP amplifier.", formulaText: "(Existing AP + bonus AD × ConversionRate) × (1 + APAmp)", confidence: "exact", order: 20 },
  { name: "escAPADe", kind: "augment", sourceStat: "abilityPower", targetStat: "bonusAttackDamage", operation: "convert", coefficientKey: "ConversionRate", multiplierKey: "ADAmp", multiplierBaseStat: "baseAttackDamage", description: "Converts AP into bonus AD, then applies its total-AD amplifier.", formulaText: "(Base AD + existing bonus AD + AP × ConversionRate) × (1 + ADAmp) − Base AD", confidence: "exact", order: 20 },
  { name: "Overlord's Bloodmail", kind: "item", sourceStat: "bonusHealth", targetStat: "bonusAttackDamage", operation: "gain", fixedCoefficient: 0.03, description: "Tyranny adds AD equal to 3% of bonus health.", formulaText: "Bonus health × 0.03", confidence: "exact", order: 30 },
  { name: "Eureka", kind: "augment", sourceStat: "abilityPower", targetStat: "abilityHaste", operation: "gain", coefficientKey: "APToHasteConversion", description: "Turns AP into ability haste.", formulaText: "Ability power × APToHasteConversion", confidence: "exact", order: 40 },
  { name: "With Haste", kind: "augment", sourceStat: "abilityHaste", targetStat: "moveSpeed", operation: "gain", coefficientKey: "AbilityHasteToMSConversion", description: "Turns ability haste into flat move speed.", formulaText: "Ability haste × AbilityHasteToMSConversion", confidence: "exact", order: 50 },
  { name: "Tap Dancer", kind: "augment", sourceStat: "moveSpeed", targetStat: "attackSpeedPercent", operation: "gain", coefficientKey: "MSToASConversion", coefficientScale: 100, description: "Turns move speed into bonus attack-speed percentage points.", formulaText: "Move speed × MSToASConversion × 100", confidence: "exact", order: 60 },
  { name: "Aim for the Head", kind: "augment", sourceStat: "critChancePercent", targetStat: "critDamagePercent", operation: "overflow_crit", coefficientKey: "CritChanceToDamageRatio", description: "Adds 25% crit chance and damage, caps chance at 50%, then converts overflow chance into crit damage.", formulaText: "25 + max(0, crit chance + 25 - 50) × conversion ratio", confidence: "exact", order: 70 },
  { name: "Heavy Hitter", kind: "augment", sourceStat: "maxHealth", targetStat: "onHitPhysicalDamage", operation: "derived_damage", coefficientKey: "HealthPercent", description: "Calculates the extra physical damage dealt by each attack.", formulaText: "Max health × HealthPercent", confidence: "exact", order: 80 },
];

function formulaRankIndices(maxLevel: number): number[] {
  return Array.from({ length: Math.max(1, maxLevel) }, (_, level) => level + 1);
}

export function getStatFormulas(): StatFormula[] {
  const db = getDatabase();
  const select = db.prepare(`
    SELECT entity_key, name, icon_url, patch, source_url, raw_json
    FROM entities WHERE kind = ? AND lower(name) = lower(?)
    ORDER BY purchasable DESC, CASE WHEN kind = 'augment' AND numeric_id < 1000 THEN 0 ELSE 1 END, numeric_id DESC LIMIT 1
  `);
  return FORMULA_SPECS.flatMap((spec) => {
    const row = select.get(spec.kind, spec.name) as EntityRow | undefined;
    if (!row) return [];
    const raw = JSON.parse(String(row.raw_json)) as { dataValues?: Record<string, unknown> };
    const values = raw.dataValues ?? {};
    const maxLevelValues = values.MaxLevel;
    const maxLevel = Array.isArray(maxLevelValues) ? Number(maxLevelValues[0] ?? 1) : 1;
    const coefficients = spec.fixedCoefficient == null ? values[spec.coefficientKey ?? ""] : undefined;
    const multipliers = spec.multiplierKey ? values[spec.multiplierKey] : undefined;
    const coefficientValues = Array.isArray(coefficients) ? coefficients.map(Number) : [];
    const multiplierValues = Array.isArray(multipliers) ? multipliers.map(Number) : [];
    const ranks = formulaRankIndices(maxLevel).map((index, levelIndex) => ({
      level: levelIndex + 1,
      coefficient: (spec.fixedCoefficient ?? coefficientValues[index] ?? 0) * (spec.coefficientScale ?? 1) * (spec.calculationCoefficient ?? 1),
      targetMultiplier: spec.multiplierKey ? 1 + (multiplierValues[index] ?? 0) : undefined,
    }));
    return [{
      id: String(row.entity_key),
      entityKey: String(row.entity_key),
      entityName: String(row.name),
      iconUrl: String(row.icon_url),
      patch: String(row.patch),
      sourceUrl: String(row.source_url),
      sourceStat: spec.sourceStat,
      targetStat: spec.targetStat,
      operation: spec.operation,
      ranks,
      description: spec.description,
      formulaText: spec.formulaText,
      confidence: spec.confidence,
      multiplierBaseStat: spec.multiplierBaseStat,
      order: spec.order,
    } satisfies StatFormula];
  });
}

export function getEntityOptions(): EntityOption[] {
  return (getDatabase().prepare(`
    SELECT entity_key, name, kind, icon_url, rarity
    FROM entities WHERE trim(name) <> ''
    ORDER BY kind, name
  `).all() as EntityRow[]).map((row) => ({
    entityKey: String(row.entity_key),
    name: String(row.name),
    kind: String(row.kind) as EntityKind,
    iconUrl: String(row.icon_url),
    rarity: String(row.rarity),
  }));
}

export type ResolvedSelectionOption = EntityOption & { numericId: number | null; catalogued: boolean };

export function resolveSelectionOptions(references: readonly string[]): ResolvedSelectionOption[] {
  const select = getDatabase().prepare(`
    SELECT entity_key, numeric_id, name, kind, icon_url, rarity
    FROM entities WHERE entity_key = ? AND kind = 'augment'
  `);
  return references.map((reference) => {
    const entityKey = normalizedSelectionKey(reference);
    const row = select.get(entityKey) as EntityRow | undefined;
    if (row) return {
      entityKey: String(row.entity_key),
      numericId: Number(row.numeric_id),
      name: String(row.name),
      kind: "augment",
      iconUrl: String(row.icon_url ?? ""),
      rarity: String(row.rarity ?? ""),
      catalogued: true,
    };
    return {
      entityKey,
      numericId: selectionNumericId(reference),
      name: uncataloguedSelectionLabel(reference),
      kind: "augment",
      iconUrl: "",
      rarity: "uncatalogued",
      catalogued: false,
    };
  });
}

export function searchCatalog(options: { kind: EntityKind; query?: string; tag?: string; limit?: number }): CatalogEntity[] {
  const db = getDatabase();
  const query = `%${(options.query ?? "").trim()}%`;
  const tag = `%\"${(options.tag ?? "").trim()}\"%`;
  const limit = Math.min(Math.max(options.limit ?? 48, 1), 200);
  const rows = db.prepare(`
    SELECT * FROM entities
    WHERE kind = ?
      AND (? = '%%' OR name LIKE ? OR description LIKE ? OR tooltip LIKE ?)
      AND (? = '%""%' OR tags_json LIKE ?)
    ORDER BY
      CASE rarity WHEN 'prismatic' THEN 0 WHEN 'gold' THEN 1 WHEN 'silver' THEN 2 ELSE 3 END,
      purchasable DESC,
      name
    LIMIT ?
  `).all(options.kind, query, query, query, query, tag, tag, limit) as EntityRow[];
  return rows.map(mapEntity);
}

function comboEntities(keys: string[]): Combo["entities"] {
  if (keys.length === 0) return [];
  const db = getDatabase();
  const statement = db.prepare("SELECT entity_key, name, icon_url, rarity, kind FROM entities WHERE entity_key = ?");
  return keys.flatMap((key) => {
    const row = statement.get(key) as EntityRow | undefined;
    return row
      ? [{
          entityKey: String(row.entity_key),
          name: String(row.name),
          iconUrl: String(row.icon_url),
          rarity: String(row.rarity),
          kind: String(row.kind) as EntityKind,
        }]
      : [];
  });
}

export function searchCombos(options: { query?: string; goal?: string; champion?: string; ownedEntityKey?: string; curatedOnly?: boolean; limit?: number }): Combo[] {
  const db = getDatabase();
  const rawQuery = (options.query ?? "").trim();
  let ownedEntityKey = (options.ownedEntityKey ?? "").trim();
  let inferredOwnedEntity = false;
  if (!ownedEntityKey && rawQuery) {
    const exactEntity = db.prepare("SELECT entity_key FROM entities WHERE lower(name) = lower(?) LIMIT 1")
      .get(rawQuery) as { entity_key?: string } | undefined;
    if (exactEntity?.entity_key) {
      ownedEntityKey = exactEntity.entity_key;
      inferredOwnedEntity = true;
    }
  }
  const query = `%${inferredOwnedEntity ? "" : rawQuery}%`;
  const ownedPattern = `%\"${ownedEntityKey}\"%`;
  const goal = `%\"${(options.goal ?? "").trim()}\"%`;
  const championName = (options.champion ?? "").trim();
  let selectedChampion: { name: string; tags: string[] } | undefined;
  if (championName) {
    const champion = db.prepare("SELECT name, tags_json FROM champions WHERE champion_key = ? OR name = ? LIMIT 1")
      .get(championName, championName) as { name: string; tags_json: string } | undefined;
    if (champion) selectedChampion = { name: champion.name, tags: jsonArray(champion.tags_json) };
  }
  const championNames = new Set(
    (db.prepare("SELECT name FROM champions").all() as Array<{ name: string }>).map((row) => row.name),
  );
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const rows = db.prepare(`
    SELECT * FROM combos
    WHERE (? = '' OR entity_keys_json LIKE ?)
      AND (? = '%%' OR title LIKE ? OR summary LIKE ?)
      AND (? = '%""%' OR goal_tags_json LIKE ?)
      AND (? = 0 OR generated = 0)
    ORDER BY CASE origin WHEN 'curated' THEN 0 WHEN 'video' THEN 1 ELSE 2 END, score DESC, title
    LIMIT 2000
  `).all(ownedEntityKey, ownedPattern, query, query, query, goal, goal, options.curatedOnly ? 1 : 0) as EntityRow[];

  const candidates: Combo[] = rows.map((row) => {
      const tags = jsonArray(row.champion_tags_json);
      return {
        slug: String(row.slug),
        title: String(row.title),
        summary: String(row.summary),
        entityKeys: jsonArray(row.entity_keys_json),
        championTags: tags,
        goalTags: jsonArray(row.goal_tags_json),
        score: Number(row.score),
        evidenceUrl: String(row.evidence_url ?? ""),
        evidenceUrls: row.evidence_url ? [String(row.evidence_url)] : [],
        evidenceNote: String(row.evidence_note ?? ""),
        patch: String(row.patch),
        generated: Boolean(row.generated),
        origin: String(row.origin ?? (row.generated ? "generated" : "curated")) as Combo["origin"],
        entities: [] as Combo["entities"],
      };
    });

  if (ownedEntityKey && !options.curatedOnly) {
    type MechanicRow = {
      entity_key: string;
      name: string;
      kind: EntityKind;
      tags_json: string;
      produces_json: string;
      consumes_json: string;
    };
    const owned = db.prepare(`
      SELECT entity_key, name, kind, tags_json, produces_json, consumes_json FROM entities WHERE entity_key = ?
    `).get(ownedEntityKey) as MechanicRow | undefined;
    if (owned) {
      const ownedTags = jsonArray(owned.tags_json);
      const ownedProduces = jsonArray(owned.produces_json);
      const ownedConsumes = jsonArray(owned.consumes_json);
      const meaningfulSharedTags = new Set([
        "ability_power", "attack_damage", "attack_speed", "ability_haste", "movement_speed",
        "crit_chance", "crit_damage", "critical", "heal_shield", "mana", "on_hit", "burn",
        "curse", "cursed_power", "stacking", "stat_anvil", "conversion",
      ]);
      const partners = db.prepare(`
        SELECT entity_key, name, kind, tags_json, produces_json, consumes_json
        FROM entities WHERE entity_key <> ? AND (kind = 'augment' OR purchasable = 1)
      `).all(ownedEntityKey) as MechanicRow[];
      for (const partner of partners) {
        const partnerTags = jsonArray(partner.tags_json);
        const partnerProduces = jsonArray(partner.produces_json);
        const partnerConsumes = jsonArray(partner.consumes_json);
        const forward = ownedProduces.filter((stat) => partnerConsumes.includes(stat));
        const reverse = partnerProduces.filter((stat) => ownedConsumes.includes(stat));
        const shared = ownedTags.filter((tag) => meaningfulSharedTags.has(tag) && partnerTags.includes(tag));
        if (forward.length + reverse.length === 0 && shared.length < 2) continue;
        const goals = [...new Set([...forward, ...reverse, ...shared])];
        if (options.goal && !goals.includes(options.goal)) continue;
        const directText = [
          forward.length ? `${owned.name} supplies ${forward.join(", ").replaceAll("_", " ")} used by ${partner.name}` : "",
          reverse.length ? `${partner.name} supplies ${reverse.join(", ").replaceAll("_", " ")} used by ${owned.name}` : "",
        ].filter(Boolean).join("; ");
        candidates.push({
          slug: `owned-${owned.entity_key}-${partner.entity_key}`.replaceAll(":", "-"),
          title: `${owned.name} → ${partner.name}`,
          summary: directText || `${owned.name} and ${partner.name} share the ${shared.join(", ").replaceAll("_", " ")} payoff package. This is an on-demand compatibility lead for the item or augment you already own.`,
          entityKeys: [owned.entity_key, partner.entity_key],
          championTags: [],
          goalTags: goals,
          score: 54 + (forward.length + reverse.length) * 12 + Math.min(shared.length, 4) * 4 + (partner.kind === "augment" ? 8 : 0),
          evidenceUrl: "",
          evidenceUrls: [],
          evidenceNote: directText ? "Current-tooltip producer/consumer match." : "Current-tooltip mechanic-tag overlap.",
          patch: String((db.prepare("SELECT value FROM metadata WHERE key='patch'").get() as { value?: string } | undefined)?.value ?? ""),
          generated: true,
          origin: "generated",
          entities: [],
        });
      }
    }
  }

  const championAdjusted = candidates.flatMap((combo) => {
    if (!selectedChampion) return [combo];
    const specificChampions = combo.championTags.filter((tag) => championNames.has(tag));
    if (specificChampions.length > 0) {
      return specificChampions.includes(selectedChampion.name) ? [{ ...combo, score: combo.score + 14 }] : [];
    }
    if (combo.championTags.length === 0) return [combo];
    const roleMatch = selectedChampion.tags.some((tag) => combo.championTags.includes(tag));
    return roleMatch ? [{ ...combo, score: combo.score + 5 }] : [];
  });

  const originPriority: Record<Combo["origin"], number> = { curated: 0, video: 1, generated: 2 };
  const deduped = new Map<string, Combo>();
  for (const combo of championAdjusted) {
    const key = [...combo.entityKeys].sort().join("|");
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, combo);
      continue;
    }
    const evidenceUrls = [...new Set([...existing.evidenceUrls, ...combo.evidenceUrls])];
    const preferred = originPriority[combo.origin] < originPriority[existing.origin] || combo.score > existing.score
      ? combo
      : existing;
    deduped.set(key, { ...preferred, evidenceUrls, evidenceUrl: evidenceUrls[0] ?? "" });
  }

  return [...deduped.values()]
    .map((combo) => {
      const entities = comboEntities(combo.entityKeys);
      if (combo.origin === "video" && combo.evidenceUrls.length > 1) {
        return {
          ...combo,
          title: `${entities.map((entity) => entity.name).join(" + ")} (${combo.evidenceUrls.length} recorded runs)`,
        summary: `This exact combination appears in ${combo.evidenceUrls.length} separate video records. The links are grouped here instead of repeating the same recommendation card.`,
          entities,
          score: combo.score + Math.min(combo.evidenceUrls.length - 1, 3),
        };
      }
      return { ...combo, entities };
    })
    .sort((left, right) => right.score - left.score || originPriority[left.origin] - originPriority[right.origin])
    .slice(0, limit);
}

export function searchVideos(options: { query?: string; champion?: string; limit?: number }): Video[] {
  const db = getDatabase();
  const query = `%${(options.query ?? "").trim()}%`;
  const champion = (options.champion ?? "").trim();
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const rows = db.prepare(`
    SELECT DISTINCT v.* FROM videos v
    LEFT JOIN video_champions vc ON vc.video_id = v.video_id
    LEFT JOIN champions c ON c.id = vc.champion_id
    WHERE (? = '%%' OR v.title LIKE ? OR v.description LIKE ? OR v.transcript_text LIKE ?)
      AND (? = '' OR c.champion_key = ? OR c.name = ?)
    ORDER BY v.catalog_position ASC, v.published_at DESC
    LIMIT ?
  `).all(query, query, query, query, champion, champion, champion, limit) as EntityRow[];
  const mentionStatement = db.prepare(`
    SELECT e.name, vm.source, vm.timestamp_seconds, vm.evidence_text, vm.confidence FROM video_mentions vm
    JOIN entities e ON e.entity_key = vm.entity_key
    WHERE vm.video_id = ?
    ORDER BY CASE vm.source WHEN 'title' THEN 0 WHEN 'description' THEN 1 ELSE 2 END,
      vm.confidence DESC, vm.timestamp_seconds, e.name
  `);
  return rows.map((row) => {
    const mentionRows = mentionStatement.all(String(row.video_id)) as Array<Record<string, unknown>>;
    return {
      videoId: String(row.video_id),
      title: String(row.title),
      description: String(row.description ?? ""),
      publishedAt: String(row.published_at ?? ""),
      url: String(row.url),
      thumbnailUrl: String(row.thumbnail_url ?? ""),
      transcriptStatus: String(row.transcript_status),
      mentions: [...new Set(mentionRows.map((mention) => String(mention.name)))],
      mentionDetails: mentionRows.map((mention) => ({
        entityName: String(mention.name),
        source: String(mention.source),
        timestampSeconds: mention.timestamp_seconds == null ? null : Number(mention.timestamp_seconds),
        evidenceText: String(mention.evidence_text),
        confidence: Number(mention.confidence),
      })),
    };
  });
}
