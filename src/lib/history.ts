import "server-only";

import { getDatabase, jsonArray } from "@/lib/db";

type Row = Record<string, unknown>;

export type MatchHistoryEntry = {
  matchId: string;
  startedAt: string;
  patch: string;
  region: string;
  platform: string;
  championId: number;
  championName: string;
  championIconUrl: string;
  placement: number | null;
  augmentKeys: string[];
  augments: Array<{ key: string; name: string; iconUrl: string; rarity: string }>;
  items: Array<{ key: string; name: string; iconUrl: string }>;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  level: number | null;
  durationSeconds: number;
  maxHp: number | null;
  maxAd: number | null;
  crazy: boolean;
};

const CRAZY_HP = 100_000;
const CRAZY_AD = 2_000;

function selectedPuuid(): string {
  const db = getDatabase();
  if (process.env.RIOT_PUUID?.trim()) return process.env.RIOT_PUUID.trim();
  const row = db.prepare("SELECT puuid FROM cohort_members WHERE cohort_id = 'personal' AND active = 1 ORDER BY created_at LIMIT 1").get() as Row | undefined;
  return String(row?.puuid ?? "");
}

function mapAugments(db: ReturnType<typeof getDatabase>, ids: string[]): MatchHistoryEntry["augments"] {
  const select = db.prepare("SELECT entity_key, name, icon_url, rarity FROM entities WHERE entity_key = ?");
  return ids.flatMap((key) => {
    const row = select.get(key) as Row | undefined;
    return row ? [{ key: String(row.entity_key), name: String(row.name), iconUrl: String(row.icon_url), rarity: String(row.rarity) }] : [];
  });
}

function mapItems(db: ReturnType<typeof getDatabase>, ids: string[]): MatchHistoryEntry["items"] {
  const select = db.prepare("SELECT entity_key, name, icon_url FROM entities WHERE entity_key = ? AND kind = 'item'");
  return ids.flatMap((id) => {
    const key = /^item:/.test(id) ? id : `item:${id}`;
    const row = select.get(key) as Row | undefined;
    return row ? [{ key: String(row.entity_key), name: String(row.name), iconUrl: String(row.icon_url ?? "") }] : [];
  });
}

export function getMatchHistory(limit = 100, includeAllPlayers = false): MatchHistoryEntry[] {
  const db = getDatabase();
  const puuid = selectedPuuid();
  const rows = db.prepare(`
    SELECT rp.match_id, rm.started_at, rm.patch, rm.routing_region, rm.platform,
      rp.champion_id, rp.champion_name, rp.placement, rp.augments_json, rp.items_json, rp.final_stats_json,
      rm.duration_seconds,
      c.icon_url AS champion_icon_url,
      MAX(lo.observed_max_hp) AS observed_max_hp,
      MAX(lo.observed_max_ad) AS observed_max_ad
    FROM riot_participants rp
    JOIN riot_matches rm ON rm.match_id = rp.match_id
    LEFT JOIN champions c ON c.id = rp.champion_id
    LEFT JOIN live_observations lo ON lo.champion_id = rp.champion_id
    WHERE (? = 1 OR ? = '' OR rp.puuid = ?)
    GROUP BY rp.match_id, rp.participant_index
    ORDER BY rm.started_at DESC
    LIMIT ?
  `).all(includeAllPlayers ? 1 : 0, puuid, puuid, Math.min(Math.max(limit, 1), 1_000)) as Row[];
  return rows.map((row) => {
    const augmentKeys = jsonArray(row.augments_json).map((id) => /^augment:/.test(id) ? id : `augment:${id}`);
    const itemKeys = jsonArray(row.items_json).filter((id) => id !== "0");
    let finalStats: Record<string, unknown> = {};
    try { finalStats = JSON.parse(String(row.final_stats_json ?? "{}")) as Record<string, unknown>; } catch { /* Keep partial records readable. */ }
    const finite = (key: string) => Number.isFinite(Number(finalStats[key])) ? Number(finalStats[key]) : null;
    const maxHp = row.observed_max_hp == null ? null : Number(row.observed_max_hp);
    const maxAd = row.observed_max_ad == null ? null : Number(row.observed_max_ad);
    return {
      matchId: String(row.match_id),
      startedAt: String(row.started_at),
      patch: String(row.patch),
      region: String(row.routing_region),
      platform: String(row.platform),
      championId: Number(row.champion_id),
      championName: String(row.champion_name || "Unknown champion"),
      championIconUrl: String(row.champion_icon_url ?? ""),
      placement: row.placement == null ? null : Number(row.placement),
      augmentKeys,
      augments: mapAugments(db, augmentKeys),
      items: mapItems(db, itemKeys),
      kills: finite("kills"),
      deaths: finite("deaths"),
      assists: finite("assists"),
      level: finite("champLevel"),
      durationSeconds: Number(row.duration_seconds ?? 0),
      maxHp,
      maxAd,
      crazy: (maxHp ?? 0) >= CRAZY_HP || (maxAd ?? 0) >= CRAZY_AD,
    };
  });
}

export type Trophy = {
  id: number;
  championId: number | null;
  championName: string;
  championIconUrl: string;
  augmentKeys: string[];
  augments: MatchHistoryEntry["augments"];
  stat: "HP" | "AD" | "AP" | "AS" | "Armor" | "MR" | "MS" | "Haste";
  value: number;
  endedAt: string;
};

export function getTrophies(limit = 10): Trophy[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT lo.id, lo.champion_id, lo.champion_name, lo.augment_ids_json,
      lo.observed_max_hp, lo.observed_max_ad, lo.observed_max_ap, lo.observed_max_as,
      lo.observed_max_armor, lo.observed_max_mr, lo.observed_max_ms, lo.observed_max_haste, lo.ended_at,
      c.icon_url AS champion_icon_url
    FROM live_observations lo
    LEFT JOIN champions c ON c.id = lo.champion_id
    ORDER BY MAX(lo.observed_max_hp, lo.observed_max_ad, lo.observed_max_ap, lo.observed_max_as,
      lo.observed_max_armor, lo.observed_max_mr, lo.observed_max_ms, lo.observed_max_haste) DESC, lo.ended_at DESC
    LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 100)) as Row[];
  return rows.flatMap((row) => {
    const stats: Array<[Trophy["stat"], number]> = [["HP", Number(row.observed_max_hp)], ["AD", Number(row.observed_max_ad)], ["AP", Number(row.observed_max_ap)], ["AS", Number(row.observed_max_as)], ["Armor", Number(row.observed_max_armor)], ["MR", Number(row.observed_max_mr)], ["MS", Number(row.observed_max_ms)], ["Haste", Number(row.observed_max_haste)]];
    const [stat, value] = stats.sort((left, right) => right[1] - left[1])[0];
    if (!Number.isFinite(value) || value <= 0) return [];
    const augmentKeys = jsonArray(row.augment_ids_json);
    return [{
      id: Number(row.id), championId: row.champion_id == null ? null : Number(row.champion_id),
      championName: String(row.champion_name || "Unknown champion"), championIconUrl: String(row.champion_icon_url ?? ""),
      augmentKeys, augments: mapAugments(db, augmentKeys), stat, value, endedAt: String(row.ended_at),
    }];
  });
}
