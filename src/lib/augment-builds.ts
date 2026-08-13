import "server-only";

import { queryBuildsForAugments, type AugmentBuildRecommendation } from "@/lib/augment-build-query";
import { getDatabase } from "@/lib/db";
import { getExtremeBuildCsvRows } from "@/lib/extreme-build-csv";

export type { AugmentBuildRecommendation, ConditionalItemRecommendation } from "@/lib/augment-build-query";

export function getBuildsForAugments(championId: number, augmentIds: readonly number[], limit = 5): AugmentBuildRecommendation {
  const db = getDatabase();
  const result = queryBuildsForAugments(db, championId, augmentIds, limit);
  if (result.source !== "none") return result;
  const normalizedChampion = result.championName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
  const builds = getExtremeBuildCsvRows()
    .filter((build) => build.champion.toLowerCase().replaceAll(/[^a-z0-9]+/g, "") === normalizedChampion && build.fixedItems.length > 0)
    .sort((left, right) => right.benchmarkScore - left.benchmarkScore || left.rank - right.rank);
  const build = builds[0];
  if (!build) return result;
  const items = build.fixedItems.flatMap((name) => {
    const row = db.prepare(`SELECT entity_key,numeric_id,name,icon_url FROM entities WHERE kind='item' AND lower(name)=lower(?) ORDER BY purchasable DESC,price DESC LIMIT 1`).get(name) as Record<string, unknown> | undefined;
    if (!row) return [];
    return [{
      entityKey: String(row.entity_key), numericId: Number(row.numeric_id), name: String(row.name), iconUrl: String(row.icon_url), games: 0, pickRate: 0,
      firstPlaceRate: 0, topFourRate: 0, averagePlacement: null,
      reason: `Champion-specific mechanical fallback from ${result.championName}'s extreme-build CSV.`,
    }];
  }).slice(0, Math.max(1, Math.min(10, limit)));
  return items.length > 0 ? {
    ...result,
    source: "extreme",
    message: `Fewer than 20 localized games; showing only ${result.championName}'s mechanical extreme-build items.`,
    items,
  } : result;
}
