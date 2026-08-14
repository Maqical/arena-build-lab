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
  const previous = db.prepare("SELECT MAX(observed_max_hp) hp,MAX(observed_max_ad) ad,MAX(observed_max_ap) ap FROM live_observations WHERE champion_id=?").get(input.championId) as { hp?: number; ad?: number; ap?: number } | undefined;
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
  const observationId = Number(result.lastInsertRowid);
  const records = [
    { label: "HP", value: input.maxima.maxHealth, previous: Number(previous?.hp ?? 0) },
    { label: "AD", value: input.maxima.attackDamage, previous: Number(previous?.ad ?? 0) },
    { label: "AP", value: input.maxima.abilityPower, previous: Number(previous?.ap ?? 0) },
  ].filter((record) => record.value > record.previous && record.value > 0);
  if (records.length) {
    const best = records.sort((left, right) => (right.value / Math.max(1, right.previous)) - (left.value / Math.max(1, left.previous)))[0];
    db.prepare("INSERT OR IGNORE INTO notification_outbox(kind,dedupe_key,title,body,created_at) VALUES('personal_record',?,?,?,?)").run(`record:${observationId}`, `${input.championName} personal record`, `${Math.round(best.value).toLocaleString()} ${best.label} recorded locally.`, input.endedAt);
  }
  return observationId;
}
