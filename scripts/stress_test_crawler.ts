import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARENA_QUEUE_IDS, isArenaMatch, parseRiotMatch } from "../src/lib/riot/arena-match";
import { insertParsedMatch, upsertCohortMember } from "../src/lib/riot/ingestion";
import { parseRiotId, RiotApiClient } from "../src/lib/riot/riot-api";
import { RiotRequestQueue } from "../src/lib/riot/request-queue";
import { SCHEMA_SQL } from "../src/lib/schema";

const COHORT_ID = "stress-na-snowball";

type Row = Record<string, unknown>;
type Args = { target: number; perPlayer: number; database: string; seeds: string[] };

function loadEnvironment(): void {
  for (const name of [".env.local", ".env"]) {
    const filename = path.resolve(name);
    if (fs.existsSync(filename)) process.loadEnvFile(filename);
  }
}

function desktopSettings(): Record<string, unknown> {
  try {
    const filename = path.join(process.env.APPDATA ?? "", "Arena Build Lab", "user_settings.json");
    return JSON.parse(fs.readFileSync(filename, "utf8")) as Record<string, unknown>;
  } catch { return {}; }
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
  if (!Number.isInteger(target) || target < 1 || target > 10_000) throw new Error("--target must be an integer from 1 to 10000.");
  if (!Number.isInteger(perPlayer) || perPlayer < 1 || perPlayer > 100) throw new Error("--per-player must be an integer from 1 to 100.");
  return {
    target,
    perPlayer,
    database: path.resolve(values.get("database")?.at(-1) ?? process.env.ARENA_DB_PATH ?? (fs.existsSync(appDb) ? appDb : "data/arena.sqlite")),
    seeds: values.get("seed") ?? [],
  };
}

function totalMatches(db: DatabaseSync): number {
  return Number((db.prepare("SELECT COUNT(*) AS count FROM riot_matches").get() as Row).count);
}

function configuredSeeds(settings: Record<string, unknown>, cliSeeds: string[]): Array<{ label: string; riotId: string }> {
  const environmentSeeds = Array.from({ length: 5 }, (_, index) =>
    String(process.env[`ARENA_STRESS_SEED_${index + 1}`] ?? "").trim(),
  );
  const candidates = [String(settings.riotId ?? "").trim(), ...cliSeeds, ...environmentSeeds].filter(Boolean);
  return [...new Set(candidates)].map((riotId, index) => ({ label: `seed_player_${index + 1}`, riotId }));
}

function participantPuuids(db: DatabaseSync, matchId: string): string[] {
  return (db.prepare("SELECT DISTINCT puuid FROM riot_participants WHERE match_id=? AND trim(puuid)<>''").all(matchId) as Row[]).map((row) => String(row.puuid));
}

function enqueueParticipant(db: DatabaseSync, puuid: string): void {
  if (!puuid) return;
  upsertCohortMember(db, { cohortId: COHORT_ID, puuid, platform: "na1", routingRegion: "americas", gameName: "", tagLine: "", seedMethod: "match_snowball" });
}

async function arenaMatchIds(client: RiotApiClient, puuid: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (const queueId of [...ARENA_QUEUE_IDS].sort((left, right) => right - left)) {
    if (ids.length >= count) break;
    const found = await client.matchIds("americas", puuid, { queueId, count: count - ids.length });
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
    const startingMatches = totalMatches(db);
    if (startingMatches >= args.target) {
      const result = {
        database: args.database,
        target: args.target,
        totalMatches: startingMatches,
        insertedThisRun: 0,
        downloadedThisRun: 0,
        processedPlayers: 0,
        frontierMembers: Number((db.prepare("SELECT COUNT(*) count FROM cohort_members WHERE cohort_id=? AND last_checked_at IS NULL").get(COHORT_ID) as Row).count),
        seedFailures: [],
      };
      fs.mkdirSync(path.resolve("qa"), { recursive: true });
      fs.writeFileSync(path.resolve("qa/stress-crawler-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const apiKey = String(process.env.RIOT_API_KEY ?? settings.riotApiKey ?? "").trim();
    if (!apiKey) throw new Error("No Riot API key is configured in .env.local or desktop Settings.");
    const requestQueue = new RiotRequestQueue(fetch, 100, 120_000);
    const client = new RiotApiClient(apiKey, requestQueue.fetch.bind(requestQueue), (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), Date.now, 120_000);
    const seeds = configuredSeeds(settings, args.seeds);
    const seedFailures: Array<{ seed: string; error: string }> = [];

    for (const seed of seeds) {
      try {
        const riotId = parseRiotId(seed.riotId);
        const account = await client.resolveAccount("americas", riotId.gameName, riotId.tagLine);
        upsertCohortMember(db, { cohortId: COHORT_ID, puuid: account.puuid, platform: "na1", routingRegion: "americas", gameName: account.gameName ?? riotId.gameName, tagLine: account.tagLine ?? riotId.tagLine, seedMethod: seed.label });
      } catch (error) {
        seedFailures.push({ seed: seed.label, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const personal = db.prepare("SELECT puuid, game_name, tag_line FROM cohort_members WHERE cohort_id='personal' AND active=1").all() as Row[];
    for (const member of personal) upsertCohortMember(db, { cohortId: COHORT_ID, puuid: String(member.puuid), platform: "na1", routingRegion: "americas", gameName: String(member.game_name ?? ""), tagLine: String(member.tag_line ?? ""), seedMethod: "personal_cohort_seed" });

    const frontier = Number((db.prepare("SELECT COUNT(*) count FROM cohort_members WHERE cohort_id=? AND last_checked_at IS NULL").get(COHORT_ID) as Row).count);
    if (frontier === 0) throw new Error("No private stress-test seeds are configured. Add --seed=\"GameName#Tag\", set ARENA_STRESS_SEED_1, or save a Riot ID in Settings.");

    let processedPlayers = 0;
    let insertedThisRun = 0;
    let downloadedThisRun = 0;
    while (totalMatches(db) < args.target) {
      const member = db.prepare(`SELECT puuid FROM cohort_members WHERE cohort_id=? AND active=1 AND last_checked_at IS NULL ORDER BY CASE seed_method WHEN 'personal_seed' THEN 0 WHEN 'personal_cohort_seed' THEN 1 ELSE 2 END, created_at LIMIT 1`).get(COHORT_ID) as Row | undefined;
      if (!member) throw new Error(`Snowball frontier exhausted at ${totalMatches(db)} matches before target ${args.target}. Add --seed="Name#Tag" and rerun; progress is preserved.`);
      const puuid = String(member.puuid);
      const ids = await arenaMatchIds(client, puuid, args.perPlayer);
      for (const matchId of ids) {
        if (totalMatches(db) >= args.target) break;
        if (db.prepare("SELECT 1 FROM riot_matches WHERE match_id=?").get(matchId)) {
          participantPuuids(db, matchId).forEach((candidate) => enqueueParticipant(db, candidate));
          continue;
        }
        const payload = await client.match("americas", matchId);
        downloadedThisRun += 1;
        if (!isArenaMatch(payload)) continue;
        const parsed = parseRiotMatch(payload, { routingRegion: "americas", platform: "na1" });
        if (insertParsedMatch(db, parsed)) insertedThisRun += 1;
        parsed.participants.forEach((participant) => enqueueParticipant(db, participant.puuid));
        if (insertedThisRun % 10 === 0) console.log(`[snowball] ${totalMatches(db)}/${args.target} matches · ${processedPlayers + 1} players · frontier ${Number((db.prepare("SELECT COUNT(*) count FROM cohort_members WHERE cohort_id=? AND last_checked_at IS NULL").get(COHORT_ID) as Row).count)}`);
      }
      db.prepare("UPDATE cohort_members SET last_checked_at=?, updated_at=? WHERE cohort_id=? AND puuid=?").run(new Date().toISOString(), new Date().toISOString(), COHORT_ID, puuid);
      processedPlayers += 1;
    }
    const result = {
      database: args.database,
      target: args.target,
      totalMatches: totalMatches(db),
      insertedThisRun,
      downloadedThisRun,
      processedPlayers,
      frontierMembers: Number((db.prepare("SELECT COUNT(*) count FROM cohort_members WHERE cohort_id=? AND last_checked_at IS NULL").get(COHORT_ID) as Row).count),
      seedFailures,
    };
    fs.mkdirSync(path.resolve("qa"), { recursive: true });
    fs.writeFileSync(path.resolve("qa/stress-crawler-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
