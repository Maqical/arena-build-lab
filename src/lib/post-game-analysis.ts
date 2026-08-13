import "server-only";

import { getDatabase, jsonArray } from "@/lib/db";

type Row = Record<string, unknown>;
export type PostGameAnalysisResult = { championName: string; peakHp: number; peakAd: number; peakAp: number; personalRecord: boolean; picked: string[]; suggested: Array<{ name: string; firstPlaceRate: number; sampleSize: number }> };

export function getPostGameAnalysis(championName = ""): PostGameAnalysisResult | null {
  const db = getDatabase();
  const observation = db.prepare(`SELECT * FROM live_observations WHERE (?='' OR lower(champion_name)=lower(?)) ORDER BY ended_at DESC LIMIT 1`).get(championName, championName) as Row | undefined;
  if (!observation) return null;
  const championId = Number(observation.champion_id ?? 0);
  const picked = jsonArray(observation.augment_ids_json);
  const names = db.prepare("SELECT name FROM entities WHERE entity_key=?");
  const pickedNames = picked.map((key) => String((names.get(key) as Row | undefined)?.name ?? key));
  const suggestions = db.prepare(`
    SELECT m.entity_key, m.value, m.sample_size, e.name
    FROM meta_snapshots m LEFT JOIN entities e
      ON e.entity_key='augment:'||substr(m.entity_key, instr(m.entity_key, ':augment:')+9)
    WHERE m.source='riot_api_local' AND m.metric='win_rate' AND m.champion_id=?
    ORDER BY m.value DESC, m.sample_size DESC LIMIT 3
  `).all(championId) as Row[];
  const peakHp = Number(observation.observed_max_hp ?? 0);
  const previous = db.prepare("SELECT MAX(observed_max_hp) value FROM live_observations WHERE id<>? AND champion_id=?").get(Number(observation.id), championId) as Row | undefined;
  return { championName: String(observation.champion_name), peakHp, peakAd: Number(observation.observed_max_ad ?? 0), peakAp: Number(observation.observed_max_ap ?? 0), personalRecord: peakHp > Number(previous?.value ?? 0), picked: pickedNames, suggested: suggestions.map((row) => ({ name: String(row.name ?? row.entity_key), firstPlaceRate: Number(row.value ?? 0), sampleSize: Number(row.sample_size ?? 0) })) };
}
