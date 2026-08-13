import "server-only";

import { loadResolverChampion, loadResolverEntity } from "@/engine/catalog";
import { resolveArenaStats, type ResolverEffect } from "@/engine/resolver";
import { getDatabase } from "@/lib/db";
import type { LiveResolveRequest, LiveResolveResponse } from "@/lib/live-overlay-types";

function crazeFactor(baseline: LiveResolveResponse["baseline"]["stats"], build: LiveResolveResponse["build"]["stats"]): number {
  const relativeGain = (after: number, before: number, floor: number) => Math.max(0, after - before) / Math.max(Math.abs(before), floor);
  const gain =
    relativeGain(build.maxHealth, baseline.maxHealth, 1_000) * 0.34 +
    relativeGain(build.totalAttackDamage, baseline.totalAttackDamage, 100) * 0.25 +
    relativeGain(build.abilityPower, baseline.abilityPower, 100) * 0.23 +
    relativeGain(build.attackSpeed, baseline.attackSpeed, 0.6) * 0.18;
  return Math.min(999, Math.round(100 + gain * 100));
}

function crazeLabel(score: number): string {
  if (score >= 500) return "Reality-breaking";
  if (score >= 300) return "Unhinged";
  if (score >= 200) return "Wild";
  if (score >= 130) return "Spicy";
  return "Baseline";
}

export function resolveLiveBuild(request: LiveResolveRequest): LiveResolveResponse {
  const db = getDatabase();
  const champion = loadResolverChampion(db, String(request.championId));
  if (!champion) throw new Error(`Unknown champion: ${request.championId}`);
  const level = Math.min(Math.max(Math.trunc(Number(request.level) || 1), 1), 30);
  const effects: ResolverEffect[] = [];
  const acceptedEntityKeys: string[] = [];
  const ignoredEntityKeys: string[] = [];
  for (const key of [...new Set(request.currentEntityKeys ?? [])]) {
    const entity = loadResolverEntity(db, key);
    if (!entity) {
      ignoredEntityKeys.push(key);
      if (/^(?:augment|card):?\d+$/i.test(key) || /^\d+$/.test(key)) {
        console.warn(`Ignored uncatalogued selection ID: ${key.replace(/^(?:augment|card):/i, "")}`);
      }
      continue;
    }
    effects.push(entity.effect);
    acceptedEntityKeys.push(key);
  }
  const baseline = resolveArenaStats(champion, level, []);
  const build = resolveArenaStats(champion, level, effects);
  const score = crazeFactor(baseline.stats, build.stats);
  return {
    champion: { id: champion.id, key: champion.key, name: champion.name },
    baseline,
    build,
    acceptedEntityKeys,
    ignoredEntityKeys,
    crazeFactor: score,
    crazeLabel: crazeLabel(score),
  };
}
