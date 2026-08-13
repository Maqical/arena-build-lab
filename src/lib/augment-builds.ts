import "server-only";

import { queryBuildsForAugments, type AugmentBuildRecommendation } from "@/lib/augment-build-query";
import { getDatabase } from "@/lib/db";

export type { AugmentBuildRecommendation, ConditionalItemRecommendation } from "@/lib/augment-build-query";

export function getBuildsForAugments(championId: number, augmentIds: readonly number[], limit = 5): AugmentBuildRecommendation {
  return queryBuildsForAugments(getDatabase(), championId, augmentIds, limit);
}
