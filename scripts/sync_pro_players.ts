import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { addRiotIdToCohort, ingestCohortMember } from "../src/lib/riot/ingestion";
import { asRiotPlatform, parseRiotId, regionalRouteForPlatform, RiotApiClient } from "../src/lib/riot/riot-api";
import { RiotRequestQueue } from "../src/lib/riot/request-queue";
import { SCHEMA_SQL } from "../src/lib/schema";

type Seed = { riotId: string; displayName: string; team: string; role: string; region: string; platform: string; sourceUrl: string };

function settings(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA ?? "", "Arena Build Lab", "user_settings.json"), "utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

async function main(): Promise<void> {
  for (const file of [".env.local", ".env"]) if (fs.existsSync(file)) process.loadEnvFile(file);
  const desktop = settings();
  const apiKey = String(process.env.RIOT_API_KEY ?? desktop.riotApiKey ?? "").trim();
  if (!apiKey) throw new Error("No Riot API key is configured.");
  const database = path.resolve(process.env.ARENA_DB_PATH ?? (fs.existsSync(path.join(process.env.APPDATA ?? "", "Arena Build Lab", "data", "arena.sqlite")) ? path.join(process.env.APPDATA ?? "", "Arena Build Lab", "data", "arena.sqlite") : "data/arena.sqlite"));
  const db = new DatabaseSync(database); db.exec(SCHEMA_SQL); db.exec("PRAGMA busy_timeout=30000");
  const queue = new RiotRequestQueue(fetch, 100, 120_000);
  const client = new RiotApiClient(apiKey, queue.fetch.bind(queue));
  const seeds = JSON.parse(fs.readFileSync(path.resolve(process.env.ARENA_PRO_SEEDS_PATH ?? "data/pro_players.seed.json"), "utf8")) as Seed[];
  const results: Array<{ player: string; insertedMatches: number; error?: string }> = [];
  try {
    for (const seed of seeds) {
      try {
        const platform = asRiotPlatform(seed.platform), routingRegion = regionalRouteForPlatform(platform), riotId = parseRiotId(seed.riotId);
        const member = await addRiotIdToCohort(db, client, { cohortId: "tracked-pros", platform, routingRegion, gameName: riotId.gameName, tagLine: riotId.tagLine, seedMethod: "public_pro_seed" });
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO pro_players(puuid,game_name,tag_line,display_name,team,role,region,platform,source_url,active,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(puuid) DO UPDATE SET game_name=excluded.game_name,tag_line=excluded.tag_line,display_name=excluded.display_name,team=excluded.team,role=excluded.role,region=excluded.region,platform=excluded.platform,source_url=excluded.source_url,active=1,updated_at=excluded.updated_at`)
          .run(member.puuid, member.gameName, member.tagLine, seed.displayName, seed.team, seed.role, seed.region, seed.platform, seed.sourceUrl, now, now);
        const summary = await ingestCohortMember(db, client, member, { count: 20, includeTimeline: true });
        db.prepare("UPDATE pro_players SET last_synced_at=?,updated_at=? WHERE puuid=?").run(now, now, member.puuid);
        if (summary.insertedMatches > 0 && db.prepare("SELECT 1 FROM followed_players WHERE puuid=? AND notify_new_match=1").get(member.puuid)) {
          db.prepare("INSERT OR IGNORE INTO notification_outbox(kind,dedupe_key,title,body,created_at) VALUES('pro_match',?,?,?,?)").run(`pro:${member.puuid}:${summary.newestMatchStartMs}`, `${seed.displayName} played Arena`, `${summary.insertedMatches} new match${summary.insertedMatches === 1 ? "" : "es"} added to your local warehouse.`, now);
        }
        results.push({ player: seed.displayName, insertedMatches: summary.insertedMatches });
      } catch (error) { results.push({ player: seed.displayName, insertedMatches: 0, error: error instanceof Error ? error.message : String(error) }); }
    }
  } finally { db.close(); }
  console.log(JSON.stringify({ database, players: results }, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
