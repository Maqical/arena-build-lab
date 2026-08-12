import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";
import {
  addRiotIdToCohort,
  cohortMembers,
  ingestCohortMember,
  seedChallengerProxyCohort,
  upsertCohortMember,
} from "../src/lib/riot/ingestion";
import {
  asRiotPlatform,
  asRiotRoutingRegion,
  parseRiotId,
  platformFromTagLine,
  regionalRouteForPlatform,
  RiotApiClient,
  type RiotPlatform,
} from "../src/lib/riot/riot-api";

type Arguments = Map<string, string[]>;

function loadLocalEnvironment(): void {
  for (const filename of [".env.local", ".env"]) {
    const resolved = path.resolve(process.cwd(), filename);
    if (fs.existsSync(resolved)) process.loadEnvFile(resolved);
  }
}

function argumentsMap(argv: readonly string[]): Arguments {
  const output: Arguments = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const equal = token.indexOf("=");
    const key = token.slice(2, equal >= 0 ? equal : undefined);
    const next = equal >= 0 ? token.slice(equal + 1) : argv[index + 1]?.startsWith("--") ? "true" : argv[++index];
    output.set(key, [...(output.get(key) ?? []), next ?? "true"]);
  }
  return output;
}

function one(args: Arguments, key: string): string | undefined {
  return args.get(key)?.at(-1);
}

function integerArg(args: Arguments, key: string, fallback: number): number {
  const parsed = Number(one(args, key) ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative integer.`);
  return parsed;
}

function redactFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactFixture);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(puuid|summonerId|summonerName|riotIdGameName|riotIdTagline)$/i.test(key)) {
      output[key] = typeof child === "string" && child
        ? `redacted-${createHash("sha256").update(child).digest("hex").slice(0, 12)}`
        : child;
    } else output[key] = redactFixture(child);
  }
  return output;
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const args = argumentsMap(process.argv.slice(2));
  const players = args.get("player") ?? [];
  const puuids = args.get("puuid") ?? [];
  const inferredPlatform = players.length ? platformFromTagLine(parseRiotId(players[0]).tagLine) : null;
  const platform: RiotPlatform = asRiotPlatform(one(args, "platform") || inferredPlatform || process.env.RIOT_PLATFORM || "na1");
  const routingRegion = asRiotRoutingRegion(one(args, "region") || process.env.RIOT_REGION || regionalRouteForPlatform(platform));
  const seedCount = integerArg(args, "seed-challenger", 0);
  const matchCount = integerArg(args, "count", 20);
  const cohortId = one(args, "cohort") ?? (seedCount > 0 ? `${platform}-challenger-proxy` : "personal");
  const apiKey = process.env.RIOT_API_KEY?.trim() ?? "";
  if (!apiKey) throw new Error("RIOT_API_KEY is missing. Add it to .env.local (never NEXT_PUBLIC_RIOT_API_KEY).");

  const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA_SQL);
  db.exec("PRAGMA busy_timeout = 10000");
  const client = new RiotApiClient(apiKey);

  try {
    for (const player of players) {
      const riotId = parseRiotId(player);
      await addRiotIdToCohort(db, client, {
        cohortId,
        platform,
        routingRegion,
        gameName: riotId.gameName,
        tagLine: riotId.tagLine,
        seedMethod: cohortId === "personal" ? "personal_riot_id" : "riot_id",
      });
    }
    for (const puuid of puuids) {
      if (!puuid.trim()) throw new Error("--puuid cannot be empty.");
      upsertCohortMember(db, {
        cohortId,
        puuid: puuid.trim(),
        platform,
        routingRegion,
        gameName: "",
        tagLine: "",
        seedMethod: "manual_puuid",
      });
    }
    if (seedCount > 0) {
      const seeded = await seedChallengerProxyCohort(db, client, { cohortId, platform, routingRegion, limit: seedCount });
      console.log(`Seeded ${seeded} ${platform.toUpperCase()} Ranked Solo Challenger proxy members into ${cohortId}.`);
    }

    const members = cohortMembers(db, cohortId);
    if (!members.length) throw new Error(`Cohort "${cohortId}" has no members. Pass --player="Name#Tag", --puuid=..., or --seed-challenger=N.`);
    const capturePath = one(args, "capture-fixture");
    let captured = false;
    const summaries = [];
    for (const member of members) {
      const summary = await ingestCohortMember(db, client, member, {
        count: matchCount,
        onMatchPayload: capturePath && !captured ? async (payload) => {
          const resolved = path.resolve(process.cwd(), capturePath);
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, `${JSON.stringify(redactFixture(payload), null, 2)}\n`, "utf8");
          captured = true;
        } : undefined,
      });
      summaries.push({
        ...summary,
        puuid: createHash("sha256").update(summary.puuid).digest("hex").slice(0, 12),
      });
    }
    console.log(JSON.stringify({ database: filename, platform, routingRegion, cohortId, summaries }, null, 2));
  } finally {
    db.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
