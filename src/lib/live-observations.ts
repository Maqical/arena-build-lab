import type { DatabaseSync } from "node:sqlite";
import type { LiveChampionStats } from "./lcu/GameStateMonitor";

export type LiveObservationInput = {
  puuid?: string;
  championId: number | null;
  championName: string;
  augmentIds: string[];
  maxima: LiveChampionStats;
  queueId: number | null;
  startedAt: string;
  endedAt: string;
  source?: string;
  extra?: Record<string, unknown>;
};

export function mergeObservedMaxima(
  current: LiveChampionStats | null,
  observed: LiveChampionStats,
): LiveChampionStats {
  if (!current) return { ...observed };
  return {
    currentHealth: Math.max(current.currentHealth, observed.currentHealth),
    maxHealth: Math.max(current.maxHealth, observed.maxHealth),
    attackDamage: Math.max(current.attackDamage, observed.attackDamage),
    abilityPower: Math.max(current.abilityPower, observed.abilityPower),
    attackSpeed: Math.max(current.attackSpeed, observed.attackSpeed),
    armor: Math.max(current.armor, observed.armor),
    magicResistance: Math.max(current.magicResistance, observed.magicResistance),
    moveSpeed: Math.max(current.moveSpeed, observed.moveSpeed),
    abilityHaste: Math.max(current.abilityHaste, observed.abilityHaste),
  };
}

export function insertLiveObservation(db: DatabaseSync, input: LiveObservationInput): number {
  const result = db.prepare(`
    INSERT INTO live_observations(
      puuid, champion_id, champion_name, augment_ids_json,
      observed_max_hp, observed_max_ad, observed_max_ap, observed_max_as,
      observed_max_armor, observed_max_mr, observed_max_ms, observed_max_haste,
      queue_id, started_at, ended_at, source, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.puuid ?? "",
    input.championId,
    input.championName,
    JSON.stringify([...new Set(input.augmentIds)]),
    input.maxima.maxHealth,
    input.maxima.attackDamage,
    input.maxima.abilityPower,
    input.maxima.attackSpeed,
    input.maxima.armor,
    input.maxima.magicResistance,
    input.maxima.moveSpeed,
    input.maxima.abilityHaste,
    input.queueId,
    input.startedAt,
    input.endedAt,
    input.source ?? "live_client",
    JSON.stringify(input.extra ?? {}),
  );
  return Number(result.lastInsertRowid);
}
