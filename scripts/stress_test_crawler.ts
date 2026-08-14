import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARENA_QUEUE_IDS, isArenaMatch, parseRiotMatch } from "../src/lib/riot/arena-match";
import { insertItemTimeline, insertParsedMatch, upsertCohortMember } from "../src/lib/riot/ingestion";
import { asRiotPlatform, parseRiotId, regionalRouteForPlatform, RiotApiClient, type RiotPlatform, type RiotRoutingRegion } from "../src/lib/riot/riot-api";
import { RiotRequestQueue } from "../src/lib/riot/request-queue";
import { SCHEMA_SQL } from "../src/lib/schema";

type Row = Record<string, unknown>;
type Args = { target: number; perPlayer: number; database: string; seeds: string[]; platform: RiotPlatform; routingRegion: RiotRoutingRegion; cohortId: string };

function loadEnvironment(): void {
  for (const name of [".env.local", ".env"]) if (fs.existsSync(path.resolve(name))) process.loadEnvFile(path.resolve(name));
}

function desktopSettings(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA ?? "", "Arena Build Lab", "user_settings.json"), "utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

function argumentsFrom(argv: string[]): Args {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const equal = token.indexOf("=");
    const key = token.slice(2, equal < 0 ? undefined : equal);
    const value = equal >= 0 ? token.slice(equal + 1) : argv[index + 1]?.startsWith("--") ? "true" : argv[++index];
    values.set(key, [...(values.get(key) ?? []), value ?? "true"]);
  }
  const appDb = path.join(process.env.APPDATA ?? "", "Arena Build Lab", "data", "arena.sqlite");
  const target = Number(values.get("target")?.at(-1) ?? 1_000);
  const perPlayer = Number(values.get("per-player")?.at(-1) ?? 20);
  const requestedRegion = String(values.get("region")?.at(-1) ?? "na").toLowerCase();
  const platform = asRiotPlatform(String(values.get("platform")?.at(-1) ?? (requestedRegion === "kr" ? "kr" : "na1")));
  if (!Number.isInteger(target) || target < 1 || target > 10_000) throw new Error("--target must be an integer from 1 to 10000.");
  if (!Number.isInteger(perPlayer) || perPlayer < 1 || perPlayer > 100) throw new Error("--per-player must be an integer from 1 to 100.");
  const shortRegion = platform === "kr" ? "kr" : platform === "na1" ? "na" : platform;
  return {
    target,
    perPlayer,
    database: path.resolve(values.get("database")?.at(-1) ?? process.env.ARENA_DB_PATH ?? (fs.existsSync(appDb) ? appDb : "data/arena.sqlite")),
    seeds: values.get("seed") ?? [],
    platform,
    routingRegion: regionalRouteForPlatform(platform),
    cohortId: `stress-${shortRegion}-snowball`,
  };
}

function regionMatchCount(db: DatabaseSync, platform: RiotPlatform): number {
  return Number((db.prepare("SELECT COUNT(*) count FROM riot_matches WHERE platform=?").get(platform) as Row).count);
}

function publicSeeds(platform: RiotPlatform): string[] {
  try {
    const rows = JSON.parse(fs.readFileSync(path.resolve("data/pro_players.seed.json"), "utf8")) as Array<{ riotId?: string; platform?: string }>;
    return rows.filter((row) => row.platform === platform).map((row) => String(row.riotId ?? "").trim()).filter(Boolean);
  } catch { return []; }
}

function configuredSeeds(settings: Record<string, unknown>, args: Args): Array<{ label: string; riotId: string }> {
  const prefix = args.platform === "kr" ? "ARENA_KR_SEED" : "ARENA_STRESS_SEED";
  const environment = Array.from({ length: 5 }, (_, index) => String(process.env[`${prefix}_${index + 1}`] ?? "").trim());
  const personal = args.platform === "na1" ? [String(settings.riotId ?? "").trim()] : [];
  return [...new Set([...personal, ...args.seeds, ...environment, ...publicSeeds(args.platform)].filter(Boolean))]
    .map((riotId, index) => ({ label: `seed_player_${index + 1}`, riotId }));
}

function participantPuuids(db: DatabaseSync, matchId: string): string[] {
  return (db.prepare("SELECT DISTINCT puuid FROM riot_participants WHERE match_id=? AND trim(puuid)<>''").all(matchId) as Row[]).map((row) => String(row.puuid));
}

function enqueueParticipant(db: DatabaseSync, puuid: string, args: Args): void {
  if (puuid) upsertCohortMember(db, { cohortId: args.cohortId, puuid, platform: args.platform, routingRegion: args.routingRegion, gameName: "", tagLine: "", seedMethod: "match_snowball" });
}

async function arenaMatchIds(client: RiotApiClient, region: RiotRoutingRegion, puuid: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (const queueId of [...ARENA_QUEUE_IDS].sort((left, right) => right - left)) {
    if (ids.length >= count) break;
    const found = await client.matchIds(region, puuid, { queueId, count: count - ids.length });
    for (const id of found) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function main(): Promise<void> {
  loadEnvironment();
  const settings = desktopSettings();
  const args = argumentsFrom(process.argv.slice(2));
  fs.mkdirSync(path.dirname(args.database), { recursive: true });
  const db = new DatabaseSync(args.database);
  db.exec(SCHEMA_SQL);
  db.exec("PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  try {
    const startingMatches = regionMatchCount(db, args.platform);
    if (startingMatches >= args.target) {
      console.log(JSON.stringify({ database: args.database, platform: args.platform, routingRegion: args.routingRegion, target: args.target, totalMatches: startingMatches, insertedThisRun: 0, downloadedThisRun: 0, processedPlayers: 0, frontierMembers: 0, seedFailures: [] }, null, 2));
      return;
    }
    const apiKey = String(process.env.RIOT_API_KEY ?? settings.riotApiKey ?? "").trim();
    if (!apiKey) throw new Error("No Riot API key is configured in .env.local or desktop Settings.");
    const requestQueue = new RiotRequestQueue(fetch, 100, 120_000);
    const client = new RiotApiClient(apiKey, requestQueue.fetch.bind(requestQueue), undefined, Date.now, 120_000);
    const seedFailures: Array<{ seed: string; error: string }> = [];
    for (const seed of configuredSeeds(settings, args)) {
      try {
        const riotId = parseRiotId(seed.riotId);
        const account = await client.resolveAccount(args.routingRegion, riotId.gameName, riotId.tagLine);
        upsertCohortMember(db, { cohortId: args.cohortId, puuid: account.puuid, platform: args.platform, routingRegion: args.routingRegion, gameName: account.gameName ?? riotId.gameName, tagLine: account.tagLine ?? riotId.tagLine, seedMethod: seed.label });
      } catch (error) { seedFailures.push({ seed: seed.label, error: error instanceof Error ? error.message : String(error) }); }
    }
    const personal = db.prepare("SELECT puuid,game_name,tag_line FROM cohort_members WHERE cohort_id='personal' AND active=1 AND platform=?").all(args.platform) as Row[];
    for (const member of personal) upsertCohortMember(db, { cohortId: args.cohortId, puuid: String(member.puuid), platform: args.platform, routingRegion: args.routingRegion, gameName: String(member.game_name ?? ""), tagLine: String(member.tag_line ?? ""), seedMethod: "personal_cohort_seed" });

    let processedPlayers = 0, insertedThisRun = 0, downloadedThisRun = 0;
    while (regionMatchCount(db, args.platform) < args.target) {
      const member = db.prepare("SELECT puuid FROM cohort_members WHERE cohort_id=? AND active=1 AND last_checked_at IS NULL ORDER BY created_at LIMIT 1").get(args.cohortId) as Row | undefined;
      if (!member) throw new Error(`Snowball frontier exhausted at ${regionMatchCount(db, args.platform)} ${args.platform} matches. Add --seed=\"Name#Tag\" and rerun.`);
      const puuid = String(member.puuid);
      for (const matchId of await arenaMatchIds(client, args.routingRegion, puuid, args.perPlayer)) {
        if (regionMatchCount(db, args.platform) >= args.target) break;
        if (db.prepare("SELECT 1 FROM riot_matches WHERE match_id=?").get(matchId)) { participantPuuids(db, matchId).forEach((candidate) => enqueueParticipant(db, candidate, args)); continue; }
        const payload = await client.match(args.routingRegion, matchId);
        downloadedThisRun += 1;
        if (!isArenaMatch(payload)) continue;
        const parsed = parseRiotMatch(payload, { routingRegion: args.routingRegion, platform: args.platform });
        if (insertParsedMatch(db, parsed)) {
          insertedThisRun += 1;
          try { insertItemTimeline(db, matchId, await client.timeline(args.routingRegion, matchId)); }
          catch (error) { console.warn(`[timeline:${matchId}] ${error instanceof Error ? error.message : String(error)}`); }
        }
        parsed.participants.forEach((participant) => enqueueParticipant(db, participant.puuid, args));
        if (insertedThisRun > 0 && insertedThisRun % 10 === 0) console.log(`[snowball:${args.platform}] ${regionMatchCount(db, args.platform)}/${args.target} matches · ${processedPlayers + 1} players`);
      }
      const now = new Date().toISOString();
      db.prepare("UPDATE cohort_members SET last_checked_at=?,updated_at=? WHERE cohort_id=? AND puuid=?").run(now, now, args.cohortId, puuid);
      processedPlayers += 1;
    }
    const result = { database: args.database, platform: args.platform, routingRegion: args.routingRegion, target: args.target, totalMatches: regionMatchCount(db, args.platform), insertedThisRun, downloadedThisRun, processedPlayers, frontierMembers: Number((db.prepare("SELECT COUNT(*) count FROM cohort_members WHERE cohort_id=? AND last_checked_at IS NULL").get(args.cohortId) as Row).count), seedFailures };
    fs.mkdirSync(path.resolve("qa"), { recursive: true });
    fs.writeFileSync(path.resolve(`qa/stress-crawler-${args.platform}-report.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
