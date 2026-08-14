import { getBuildsForAugments } from "@/lib/augment-builds";
import { getDatabase } from "@/lib/db";
import { resolveLiveBuild } from "@/lib/live-build";
import type { LiveResolveRequest } from "@/lib/live-overlay-types";

export const runtime = "nodejs";

type StatMap = ReturnType<typeof resolveLiveBuild>["build"]["stats"];

function statDeltas(before: StatMap, after: StatMap) {
  return {
    health: after.maxHealth - before.maxHealth,
    attackDamage: after.totalAttackDamage - before.totalAttackDamage,
    abilityPower: after.abilityPower - before.abilityPower,
    attackSpeed: after.attackSpeed - before.attackSpeed,
    armor: after.armor - before.armor,
    magicResistance: after.magicResistance - before.magicResistance,
    haste: after.abilityHaste - before.abilityHaste,
    moveSpeed: after.moveSpeed - before.moveSpeed,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as LiveResolveRequest & { offeredItemKeys?: string[] };
    const offeredItemKeys = [...new Set(body.offeredItemKeys ?? [])];
    if (offeredItemKeys.length !== 3) return Response.json({ error: "Exactly three Prismatic item offers are required." }, { status: 400 });
    const db = getDatabase();
    const offeredRows = offeredItemKeys.map((key) => db.prepare("SELECT entity_key,numeric_id,name,icon_url FROM entities WHERE entity_key=? AND kind='item' LIMIT 1").get(key) as { entity_key: string; numeric_id: number; name: string; icon_url: string } | undefined);
    if (offeredRows.some((row) => !row)) return Response.json({ error: "One or more offered items are not in the local catalog." }, { status: 400 });
    const current = resolveLiveBuild(body);
    const augmentIds = body.currentEntityKeys.flatMap((key) => {
      const row = db.prepare("SELECT numeric_id FROM entities WHERE entity_key=? AND kind='augment' LIMIT 1").get(key) as { numeric_id: number } | undefined;
      return row ? [row.numeric_id] : [];
    });
    const conditional = augmentIds.length > 0 ? getBuildsForAugments(current.champion.id ?? 0, augmentIds, 6) : null;
    const observedRanks = new Map((conditional?.items ?? []).map((item, index) => [item.entityKey, { index, item }]));
    const options = offeredRows.map((row) => {
      const entity = row!;
      const resolved = resolveLiveBuild({ championId: body.championId, level: body.level, currentEntityKeys: [...body.currentEntityKeys, entity.entity_key] });
      const observed = observedRanks.get(entity.entity_key);
      const score = resolved.crazeFactor + (observed ? Math.max(5, 45 - observed.index * 7) : 0);
      return {
        entity: { entityKey: entity.entity_key, numericId: entity.numeric_id, name: entity.name, iconUrl: entity.icon_url },
        deltas: statDeltas(current.build.stats, resolved.build.stats),
        crazeFactor: resolved.crazeFactor,
        score,
        observed: observed ? { pickRate: observed.item.pickRate, games: observed.item.games, source: conditional?.source } : null,
        nextItems: (conditional?.items ?? []).filter((item) => item.entityKey !== entity.entity_key).slice(0, 3).map((item) => ({ entityKey: item.entityKey, name: item.name, iconUrl: item.iconUrl })),
      };
    });
    const recommendation = [...options].sort((left, right) => right.score - left.score)[0];
    return Response.json({
      champion: current.champion,
      sampleSize: conditional?.sampleSize ?? 0,
      source: conditional?.source ?? "mechanical",
      message: conditional?.message ?? "Ranked from this champion's live mechanical stat deltas.",
      options,
      recommendation: { entityKey: recommendation.entity.entityKey, name: recommendation.entity.name, rationale: recommendation.observed
        ? `${recommendation.entity.name} is present in this champion and augment cohort, then continues into the displayed localized item path.`
        : `${recommendation.entity.name} produces the strongest currently executable stat gain for this champion and owned augment set.` },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
