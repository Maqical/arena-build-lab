import "server-only";
import { getDatabase } from "@/lib/db";
import type { CompanionRegion } from "@/lib/region";

type Row = Record<string, unknown>;
export type ProPlayerCard = { puuid:string;riotId:string;displayName:string;team:string;role:string;region:string;sourceUrl:string;followed:boolean;lastSyncedAt:string;games:number;recent:Array<{matchId:string;championName:string;placement:number|null;augments:string[];items:string[];startedAt:string}> };

function array(value: unknown): number[] { try { const parsed=JSON.parse(String(value??"[]")); return Array.isArray(parsed)?parsed.map(Number).filter(Number.isInteger):[]; } catch{return[];} }

export function proPlayers(region: CompanionRegion): ProPlayerCard[] {
  const db=getDatabase();
  const players=db.prepare(`SELECT p.*,CASE WHEN f.puuid IS NULL THEN 0 ELSE 1 END followed FROM pro_players p LEFT JOIN followed_players f ON f.puuid=p.puuid WHERE p.active=1 AND (?='global' OR p.region=?) ORDER BY followed DESC,p.team,p.display_name`).all(region,region) as Row[];
  const matches=db.prepare(`SELECT rp.match_id,rp.champion_name,rp.placement,rp.augments_json,rp.items_json,rm.started_at FROM riot_participants rp JOIN riot_matches rm ON rm.match_id=rp.match_id WHERE rp.puuid=? ORDER BY rm.started_at DESC LIMIT 8`);
  const entity=db.prepare("SELECT name FROM entities WHERE numeric_id=? AND kind=? ORDER BY purchasable DESC LIMIT 1");
  const names=(value:unknown,kind:"augment"|"item")=>array(value).map((id)=>String((entity.get(id,kind) as Row|undefined)?.name??`Uncatalogued ${kind} ${id}`));
  return players.map((player)=>{const recent=(matches.all(String(player.puuid)) as Row[]).map((row)=>({matchId:String(row.match_id),championName:String(row.champion_name),placement:row.placement==null?null:Number(row.placement),augments:names(row.augments_json,"augment"),items:names(row.items_json,"item"),startedAt:String(row.started_at)}));return{puuid:String(player.puuid),riotId:`${player.game_name}#${player.tag_line}`,displayName:String(player.display_name),team:String(player.team),role:String(player.role),region:String(player.region),sourceUrl:String(player.source_url??""),followed:Boolean(player.followed),lastSyncedAt:String(player.last_synced_at??""),games:recent.length,recent};});
}

export function setProFollow(puuid:string,follow:boolean): boolean {
  const db=getDatabase();
  if(!db.prepare("SELECT 1 FROM pro_players WHERE puuid=?").get(puuid))return false;
  if(follow)db.prepare("INSERT OR REPLACE INTO followed_players(puuid,notify_new_match,followed_at) VALUES(?,1,?)").run(puuid,new Date().toISOString());
  else db.prepare("DELETE FROM followed_players WHERE puuid=?").run(puuid);
  return true;
}
