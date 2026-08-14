import "server-only";

import { getDatabase } from "@/lib/db";
import { performanceGrade, performanceScore, tierForRank } from "@/lib/competitive-insights-core";
import { platformForRegion, type CompanionRegion } from "@/lib/region";

type Row = Record<string, unknown>;
export type TierEntry = { entityKey:string;championId: number; name: string; iconUrl: string; tier: string; score: number; firstPlaceRate: number; top4Rate: number; pickRate: number; averagePlacement: number; sampleSize: number; patch: string };
export type MatchupEntry = { championId: number; name: string; iconUrl: string; games: number; aheadRate: number; averagePlacement: number };
export type DuoEntry = { championId: number; name: string; iconUrl: string; games: number; firstPlaceRate: number; expectedRate: number; synergyScore: number };
export type TrendPoint = { patch: string; value: number; sampleSize: number };
export type BuildPath = { itemIds: number[]; items: Array<{ id: number; name: string; iconUrl: string }>; games: number; share: number };

export function availablePatches(region: CompanionRegion, limit = 8): string[] {
  const filter=regionClause(region);
  return (getDatabase().prepare(`SELECT DISTINCT rm.patch FROM riot_matches rm WHERE trim(rm.patch)<>''${filter.sql} ORDER BY CAST(substr(rm.patch,1,instr(rm.patch,'.')-1) AS INTEGER) DESC,CAST(substr(rm.patch,instr(rm.patch,'.')+1) AS INTEGER) DESC LIMIT ?`).all(...filter.values,limit) as Row[]).map((row)=>String(row.patch));
}

function regionClause(region: CompanionRegion, alias = "rm"): { sql: string; values: string[] } {
  const platform = platformForRegion(region);
  return platform ? { sql: ` AND ${alias}.platform=?`, values: [platform] } : { sql: "", values: [] };
}

export function tierList(region: CompanionRegion, patch = ""): TierEntry[] {
  const db = getDatabase();
  const platform = platformForRegion(region);
  const selectedPatch = patch || String((db.prepare("SELECT patch FROM riot_matches WHERE (?='' OR platform=?) ORDER BY started_at DESC LIMIT 1").get(platform ?? "", platform ?? "") as Row | undefined)?.patch ?? "");
  if (!selectedPatch) return [];
  const rows = db.prepare(`
    WITH filtered AS MATERIALIZED (
      SELECT entity_key,metric,value,average_placement,sample_size
      FROM meta_snapshots
      WHERE source='riot_api_local' AND region=? AND patch=? AND kind='champion'
    )
    SELECT c.id champion_id,c.name,c.icon_url,m.entity_key,
      MAX(CASE WHEN m.metric='win_rate' THEN m.value END) first_rate,
      MAX(CASE WHEN m.metric='top4_rate' THEN m.value END) top4_rate,
      MAX(CASE WHEN m.metric='pick_rate' THEN m.value END) pick_rate,
      MAX(m.average_placement) average_placement,MAX(m.sample_size) sample_size
    FROM filtered m JOIN champions c ON m.entity_key='champion:'||c.champion_key
    GROUP BY c.id,c.name,c.icon_url,m.entity_key
  `).all(region, selectedPatch) as Row[];
  const ranked = rows.map((row) => {
    const firstPlaceRate = Number(row.first_rate ?? 0), top4Rate = Number(row.top4_rate ?? 0), pickRate = Number(row.pick_rate ?? 0);
    return { entityKey:String(row.entity_key),championId: Number(row.champion_id), name: String(row.name), iconUrl: String(row.icon_url), firstPlaceRate, top4Rate, pickRate, averagePlacement: Number(row.average_placement ?? 0), sampleSize: Number(row.sample_size ?? 0), patch: selectedPatch, score: firstPlaceRate * 0.5 + top4Rate * 0.35 + Math.min(1, pickRate * 10) * 0.15 };
  }).sort((left, right) => right.score - left.score || right.sampleSize - left.sampleSize);
  return ranked.map((entry, index) => ({ ...entry, tier: tierForRank(index, ranked.length) }));
}

export function championMatchups(championId: number, region: CompanionRegion, limit = 12): MatchupEntry[] {
  const filter = regionClause(region);
  const rows = getDatabase().prepare(`
    SELECT b.champion_id,c.name,c.icon_url,COUNT(*) games,
      AVG(CASE WHEN a.placement<b.placement THEN 1.0 WHEN a.placement=b.placement THEN .5 ELSE 0 END) ahead_rate,
      AVG(a.placement) average_placement
    FROM riot_participants a JOIN riot_participants b ON b.match_id=a.match_id AND b.participant_index<>a.participant_index AND COALESCE(b.subteam_id,-1)<>COALESCE(a.subteam_id,-1)
    JOIN riot_matches rm ON rm.match_id=a.match_id JOIN champions c ON c.id=b.champion_id
    WHERE a.champion_id=? AND a.placement IS NOT NULL AND b.placement IS NOT NULL${filter.sql}
    GROUP BY b.champion_id,c.name,c.icon_url HAVING COUNT(*)>=2
    ORDER BY games DESC,ahead_rate DESC LIMIT ?
  `).all(championId, ...filter.values, limit) as Row[];
  return rows.map((row) => ({ championId: Number(row.champion_id), name: String(row.name), iconUrl: String(row.icon_url), games: Number(row.games), aheadRate: Number(row.ahead_rate), averagePlacement: Number(row.average_placement) }));
}

export function duoPartners(championId: number, region: CompanionRegion, limit = 12): DuoEntry[] {
  const filter = regionClause(region);
  const rows = getDatabase().prepare(`
    WITH individual AS (
      SELECT rp.champion_id,AVG(CASE WHEN rp.placement=1 THEN 1.0 ELSE 0 END) rate
      FROM riot_participants rp JOIN riot_matches rm ON rm.match_id=rp.match_id WHERE 1=1${filter.sql} GROUP BY rp.champion_id
    ), pairs AS (
      SELECT b.champion_id partner_id,COUNT(*) games,AVG(CASE WHEN a.placement=1 THEN 1.0 ELSE 0 END) pair_rate
      FROM riot_participants a JOIN riot_participants b ON b.match_id=a.match_id AND b.subteam_id=a.subteam_id AND b.participant_index<>a.participant_index
      JOIN riot_matches rm ON rm.match_id=a.match_id WHERE a.champion_id=? AND a.subteam_id IS NOT NULL${filter.sql}
      GROUP BY b.champion_id
    )
    SELECT p.partner_id,c.name,c.icon_url,p.games,p.pair_rate,(COALESCE(self.rate,0)+COALESCE(partner.rate,0))/2 expected_rate
    FROM pairs p JOIN champions c ON c.id=p.partner_id LEFT JOIN individual self ON self.champion_id=? LEFT JOIN individual partner ON partner.champion_id=p.partner_id
    ORDER BY ((p.pair_rate-((COALESCE(self.rate,0)+COALESCE(partner.rate,0))/2))*sqrt(p.games)) DESC LIMIT ?
  `).all(...filter.values, championId, ...filter.values, championId, limit) as Row[];
  return rows.map((row) => { const firstPlaceRate=Number(row.pair_rate), expectedRate=Number(row.expected_rate), games=Number(row.games); return { championId:Number(row.partner_id),name:String(row.name),iconUrl:String(row.icon_url),games,firstPlaceRate,expectedRate,synergyScore:(firstPlaceRate-expectedRate)*Math.sqrt(games) }; });
}

export function entityTrend(entityKey: string, metric: "win_rate" | "pick_rate", region: CompanionRegion): TrendPoint[] {
  return (getDatabase().prepare(`SELECT patch,value,sample_size FROM meta_snapshots WHERE source='riot_api_local' AND region=? AND entity_key=? AND metric=? ORDER BY CAST(substr(patch,1,instr(patch,'.')-1) AS INTEGER) DESC,CAST(substr(patch,instr(patch,'.')+1) AS INTEGER) DESC LIMIT 5`).all(region, entityKey, metric) as Row[])
    .reverse().map((row) => ({ patch:String(row.patch),value:Number(row.value),sampleSize:Number(row.sample_size) }));
}

export function buildPaths(championId: number, augmentIds: number[], region: CompanionRegion, limit = 5): BuildPath[] {
  const filter = regionClause(region);
  const required = [...new Set(augmentIds.filter((id) => Number.isInteger(id) && id > 0))];
  const having = required.length ? ` AND (${required.map(() => "EXISTS (SELECT 1 FROM participant_augments pa WHERE pa.match_id=rp.match_id AND pa.participant_index=rp.participant_index AND pa.augment_id=?)").join(" AND ")})` : "";
  const rows = getDatabase().prepare(`
    SELECT pie.match_id,pie.participant_index,pie.item_id,pie.timestamp_ms,pie.sequence_index
    FROM participant_item_events pie JOIN riot_participants rp ON rp.match_id=pie.match_id AND rp.participant_index=pie.participant_index
    JOIN riot_matches rm ON rm.match_id=rp.match_id
    WHERE rp.champion_id=? AND pie.event_type='ITEM_PURCHASED'
      AND EXISTS (SELECT 1 FROM entities ie WHERE ie.kind='item' AND ie.numeric_id=pie.item_id AND ie.price>500 AND lower(ie.name) NOT LIKE '%biscuit%' AND lower(ie.name) NOT LIKE '%potion%' AND lower(ie.name) NOT LIKE '%ward%' AND lower(ie.name) NOT LIKE '%trinket%')${filter.sql}${having}
    ORDER BY pie.match_id,pie.participant_index,pie.timestamp_ms,pie.sequence_index
  `).all(championId, ...filter.values, ...required) as Row[];
  const sequences = new Map<string, number[]>();
  for (const row of rows) { const key=`${row.match_id}:${row.participant_index}`; const list=sequences.get(key)??[]; const id=Number(row.item_id); if (list.at(-1)!==id) list.push(id); sequences.set(key,list); }
  const counts = new Map<string, { ids:number[]; games:number }>();
  for (const ids of sequences.values()) { const path=ids.slice(0,6); const key=path.join(","); const current=counts.get(key)??{ids:path,games:0}; current.games+=1; counts.set(key,current); }
  const total=sequences.size || 1, db=getDatabase(), item=db.prepare("SELECT name,icon_url FROM entities WHERE kind='item' AND numeric_id=? ORDER BY purchasable DESC LIMIT 1");
  return [...counts.values()].sort((a,b)=>b.games-a.games).slice(0,limit).map((entry)=>({itemIds:entry.ids,items:entry.ids.map((id)=>{const row=item.get(id) as Row|undefined;return{id,name:String(row?.name??`Item ${id}`),iconUrl:String(row?.icon_url??"")};}),games:entry.games,share:entry.games/total}));
}

export function gradeParticipant(matchId: string, participantIndex: number): { score:number; grade:string } | null {
  const db=getDatabase();
  const row=db.prepare("SELECT champion_id,placement,augments_json,final_stats_json FROM riot_participants WHERE match_id=? AND participant_index=?").get(matchId,participantIndex) as Row|undefined;
  if(!row)return null;
  const stats=JSON.parse(String(row.final_stats_json??"{}")) as Record<string,number>;
  const averages=db.prepare("SELECT AVG(CAST(json_extract(final_stats_json,'$.kills') AS REAL)+CAST(json_extract(final_stats_json,'$.assists') AS REAL)) ka,AVG(CAST(json_extract(final_stats_json,'$.deaths') AS REAL)) deaths,AVG(CAST(json_extract(final_stats_json,'$.totalDamageDealtToChampions') AS REAL)) damage,AVG(CAST(json_extract(final_stats_json,'$.damageSelfMitigated') AS REAL)) mitigated FROM riot_participants WHERE champion_id=?").get(Number(row.champion_id)) as Row;
  const kda=(Number(stats.kills??0)+Number(stats.assists??0))/Math.max(1,Number(stats.deaths??0));
  const averageKda=Number(averages.ka??0)/Math.max(1,Number(averages.deaths??0));
  const ids=JSON.parse(String(row.augments_json??"[]")) as number[];
  const qualities=ids.map((id)=>Number((db.prepare("SELECT value FROM meta_snapshots WHERE metric='win_rate' AND entity_key=? ORDER BY sample_size DESC LIMIT 1").get(`augment:${id}`) as Row|undefined)?.value??0));
  const score=performanceScore({placement:Number(row.placement??4),kdaRatio:kda/Math.max(.01,averageKda),damageRatio:Number(stats.totalDamageDealtToChampions??0)/Math.max(1,Number(averages.damage??1)),mitigatedRatio:Number(stats.damageSelfMitigated??0)/Math.max(1,Number(averages.mitigated??1)),augmentQuality:qualities.length?qualities.reduce((a,b)=>a+b,0)/qualities.length*4:0.5});
  return {score,grade:performanceGrade(score)};
}

export function personalPerformanceTrend(limit = 12): Array<{ matchId:string; championName:string; startedAt:string; score:number; grade:string }> {
  const rows=getDatabase().prepare(`SELECT rp.match_id,rp.participant_index,rp.champion_name,rm.started_at FROM riot_participants rp JOIN riot_matches rm ON rm.match_id=rp.match_id WHERE rp.puuid IN (SELECT puuid FROM cohort_members WHERE cohort_id='personal' AND active=1) ORDER BY rm.started_at DESC LIMIT ?`).all(limit) as Row[];
  return rows.flatMap((row)=>{const performance=gradeParticipant(String(row.match_id),Number(row.participant_index));return performance?[{matchId:String(row.match_id),championName:String(row.champion_name),startedAt:String(row.started_at),...performance}]:[];}).reverse();
}
