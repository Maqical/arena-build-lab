import "server-only";

import { getDatabase } from "@/lib/db";

type Row = Record<string, unknown>;
export type DuoSynergy = { championId: number; gamesTogether: number; firstPlaceRate: number; expectedFirstPlaceRate: number; synergyScore: number };

export function getDuoSynergies(championId: number, limit = 8): DuoSynergy[] {
  const rows = getDatabase().prepare(`
    WITH individual AS (
      SELECT champion_id, AVG(CASE WHEN placement=1 THEN 1.0 ELSE 0 END) rate FROM riot_participants GROUP BY champion_id
    ), pairs AS (
      SELECT b.champion_id partner_id, COUNT(*) games, AVG(CASE WHEN a.placement=1 THEN 1.0 ELSE 0 END) pair_rate
      FROM riot_participants a JOIN riot_participants b
        ON b.match_id=a.match_id AND b.subteam_id=a.subteam_id AND b.participant_index<>a.participant_index
      WHERE a.champion_id=? AND a.subteam_id IS NOT NULL GROUP BY b.champion_id
    )
    SELECT p.partner_id, p.games, p.pair_rate, (COALESCE(self.rate,0)+COALESCE(partner.rate,0))/2 expected_rate
    FROM pairs p LEFT JOIN individual self ON self.champion_id=? LEFT JOIN individual partner ON partner.champion_id=p.partner_id
    ORDER BY ((p.pair_rate-((COALESCE(self.rate,0)+COALESCE(partner.rate,0))/2))*sqrt(p.games)) DESC LIMIT ?
  `).all(championId, championId, limit) as Row[];
  return rows.map((row) => {
    const firstPlaceRate = Number(row.pair_rate ?? 0), expectedFirstPlaceRate = Number(row.expected_rate ?? 0), gamesTogether = Number(row.games ?? 0);
    return { championId: Number(row.partner_id), gamesTogether, firstPlaceRate, expectedFirstPlaceRate, synergyScore: (firstPlaceRate - expectedFirstPlaceRate) * Math.sqrt(gamesTogether) };
  });
}
