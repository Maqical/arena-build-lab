import "server-only";

import { getDatabase } from "@/lib/db";

type Row = Record<string, unknown>;
export type LobbyMemberAnalysis = { puuid: string; gameName: string; tagLine: string; games: number; firstPlaceRate: number | null; averagePlacement: number | null; mostPlayed: Array<{ championName: string; games: number }> };

export function analyzeLobbyMembers(members: Array<{ puuid: string; gameName: string; tagLine: string }>): LobbyMemberAnalysis[] {
  const db = getDatabase();
  const summary = db.prepare(`SELECT COUNT(*) games, AVG(CASE WHEN placement=1 THEN 1.0 ELSE 0 END) first_rate, AVG(placement) average_placement FROM riot_participants WHERE puuid=?`);
  const champions = db.prepare(`SELECT champion_name, COUNT(*) games FROM riot_participants WHERE puuid=? GROUP BY champion_id, champion_name ORDER BY games DESC LIMIT 3`);
  return members.map((member) => {
    const row = summary.get(member.puuid) as Row | undefined;
    const games = Number(row?.games ?? 0);
    return { ...member, games, firstPlaceRate: games ? Number(row?.first_rate) : null, averagePlacement: games ? Number(row?.average_placement) : null, mostPlayed: (champions.all(member.puuid) as Row[]).map((entry) => ({ championName: String(entry.champion_name), games: Number(entry.games) })) };
  });
}
