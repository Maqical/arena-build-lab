import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

export type ConditionalItemRecommendation = {
  entityKey: string;
  numericId: number;
  name: string;
  iconUrl: string;
  games: number;
  pickRate: number;
  firstPlaceRate: number;
  topFourRate: number;
  averagePlacement: number | null;
  reason: string;
};

export type AugmentBuildRecommendation = {
  championId: number;
  championName: string;
  augmentIds: number[];
  augmentNames: string[];
  sampleSize: number;
  lowSample: boolean;
  source: "observed" | "extreme" | "none";
  message: string;
  items: ConditionalItemRecommendation[];
};

function uniquePositiveIntegers(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].slice(0, 4);
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

export function queryBuildsForAugments(db: DatabaseSync, championId: number, requestedAugmentIds: readonly number[], limit = 5): AugmentBuildRecommendation {
  const augmentIds = uniquePositiveIntegers(requestedAugmentIds);
  const champion = db.prepare("SELECT name FROM champions WHERE id=?").get(championId) as Row | undefined;
  const augmentRows = augmentIds.length === 0 ? [] : db.prepare(`
    SELECT numeric_id, name FROM entities
    WHERE kind='augment' AND numeric_id IN (${augmentIds.map(() => "?").join(",")})
  `).all(...augmentIds) as Row[];
  const augmentNameById = new Map(augmentRows.map((row) => [Number(row.numeric_id), String(row.name)]));

  if (augmentIds.length === 0) {
    return { championId, championName: String(champion?.name ?? championId), augmentIds, augmentNames: [], sampleSize: 0, lowSample: true, source: "none", message: "Choose or scan an augment to enable localized recommendations.", items: [] };
  }

  const participantRows = db.prepare(`
    SELECT rp.match_id, rp.participant_index, rp.items_json, rp.placement
    FROM riot_participants rp
    JOIN participant_augments pa
      ON pa.match_id=rp.match_id AND pa.participant_index=rp.participant_index
    WHERE rp.champion_id=? AND pa.augment_id IN (${augmentIds.map(() => "?").join(",")})
    GROUP BY rp.match_id, rp.participant_index
    HAVING COUNT(DISTINCT pa.augment_id)=?
  `).all(championId, ...augmentIds, augmentIds.length) as Row[];

  const aggregates = new Map<number, { games: number; firsts: number; topFours: number; placementTotal: number; placementCount: number }>();
  for (const row of participantRows) {
    const placement = row.placement == null ? null : Number(row.placement);
    const itemIds = [...new Set(jsonArray(row.items_json).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    for (const itemId of itemIds) {
      const aggregate = aggregates.get(itemId) ?? { games: 0, firsts: 0, topFours: 0, placementTotal: 0, placementCount: 0 };
      aggregate.games += 1;
      if (placement === 1) aggregate.firsts += 1;
      if (placement != null && placement <= 4) aggregate.topFours += 1;
      if (placement != null) { aggregate.placementTotal += placement; aggregate.placementCount += 1; }
      aggregates.set(itemId, aggregate);
    }
  }

  const entityRows = aggregates.size === 0 ? [] : db.prepare(`
    SELECT numeric_id, entity_key, name, icon_url FROM entities
    WHERE kind='item' AND purchasable=1 AND price>500
      AND numeric_id IN (${[...aggregates].map(() => "?").join(",")})
  `).all(...aggregates.keys()) as Row[];
  const entityById = new Map(entityRows.map((row) => [Number(row.numeric_id), row]));
  const sampleSize = participantRows.length;
  const items = [...aggregates.entries()].map(([numericId, aggregate]) => {
    const entity = entityById.get(numericId);
    if (!entity) return null;
    return {
      entityKey: String(entity.entity_key),
      numericId,
      name: String(entity.name),
      iconUrl: String(entity.icon_url),
      games: aggregate.games,
      pickRate: sampleSize === 0 ? 0 : aggregate.games / sampleSize,
      firstPlaceRate: aggregate.games === 0 ? 0 : aggregate.firsts / aggregate.games,
      topFourRate: aggregate.games === 0 ? 0 : aggregate.topFours / aggregate.games,
      averagePlacement: aggregate.placementCount === 0 ? null : aggregate.placementTotal / aggregate.placementCount,
      reason: `Observed with this champion and exact augment set in ${aggregate.games} local matches.`,
    };
  }).filter((item): item is ConditionalItemRecommendation => Boolean(item))
    .sort((left, right) => right.pickRate - left.pickRate || right.topFourRate - left.topFourRate || right.games - left.games)
    .slice(0, Math.max(1, Math.min(10, limit)));

  if (sampleSize >= 20) return {
    championId,
    championName: String(champion?.name ?? championId),
    augmentIds,
    augmentNames: augmentIds.map((id) => augmentNameById.get(id) ?? `Augment ${id}`),
    sampleSize,
    lowSample: false,
    source: "observed",
    message: `Localized recommendation from ${sampleSize} matching champion + augment games.`,
    items,
  };

  const championName = String(champion?.name ?? championId);
  const extremeRows = db.prepare(`
    SELECT score, augments_json FROM extreme_builds
    WHERE lower(champion_name)=lower(?)
    ORDER BY generated_at DESC, score DESC LIMIT 100
  `).all(championName) as Row[];
  const requested = new Set(augmentIds);
  const candidates = extremeRows.map((row) => {
    const effects = (() => { try { const value = JSON.parse(String(row.augments_json ?? "[]")); return Array.isArray(value) ? value as Row[] : []; } catch { return []; } })();
    const matches = effects.filter((effect) => String(effect.kind) === "augment" && requested.has(Number(String(effect.key ?? "").replace(/^augment:/i, "")))).length;
    return { score: Number(row.score ?? 0), matches, effects };
  }).sort((left, right) => right.matches - left.matches || right.score - left.score);
  const extreme = candidates.find((candidate) => candidate.effects.some((effect) => String(effect.kind) === "item"));
  const fallbackItems = (extreme?.effects.filter((effect) => String(effect.kind) === "item") ?? []).flatMap((effect) => {
    const key = String(effect.key ?? "");
    const name = String(effect.name ?? "");
    const entity = db.prepare(`
      SELECT entity_key, numeric_id, name, icon_url FROM entities
      WHERE kind='item' AND (entity_key=? OR lower(name)=lower(?))
      ORDER BY purchasable DESC, price DESC LIMIT 1
    `).get(key, name) as Row | undefined;
    if (!entity) return [];
    return [{
      entityKey: String(entity.entity_key), numericId: Number(entity.numeric_id), name: String(entity.name), iconUrl: String(entity.icon_url),
      games: 0, pickRate: 0, firstPlaceRate: 0, topFourRate: 0, averagePlacement: null,
      reason: `Champion-specific mechanical fallback from ${championName}'s extreme-build model.`,
    } satisfies ConditionalItemRecommendation];
  }).slice(0, Math.max(1, Math.min(10, limit)));

  return {
    championId,
    championName,
    augmentIds,
    augmentNames: augmentIds.map((id) => augmentNameById.get(id) ?? `Augment ${id}`),
    sampleSize,
    lowSample: true,
    source: fallbackItems.length > 0 ? "extreme" : "none",
    message: fallbackItems.length > 0
      ? `Fewer than 20 localized games; showing only ${championName}'s mechanical extreme-build items.`
      : "No localized data. Sync matches to enable recommendations.",
    items: fallbackItems,
  };
}
