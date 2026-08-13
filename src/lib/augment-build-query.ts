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
};

export type AugmentBuildRecommendation = {
  championId: number;
  championName: string;
  augmentIds: number[];
  augmentNames: string[];
  sampleSize: number;
  lowSample: boolean;
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
    return { championId, championName: String(champion?.name ?? championId), augmentIds, augmentNames: [], sampleSize: 0, lowSample: true, items: [] };
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
    WHERE kind='item' AND purchasable=1 AND price>0
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
    };
  }).filter((item): item is ConditionalItemRecommendation => Boolean(item))
    .sort((left, right) => right.pickRate - left.pickRate || right.topFourRate - left.topFourRate || right.games - left.games)
    .slice(0, Math.max(1, Math.min(10, limit)));

  return {
    championId,
    championName: String(champion?.name ?? championId),
    augmentIds,
    augmentNames: augmentIds.map((id) => augmentNameById.get(id) ?? `Augment ${id}`),
    sampleSize,
    lowSample: sampleSize < 20,
    items,
  };
}
