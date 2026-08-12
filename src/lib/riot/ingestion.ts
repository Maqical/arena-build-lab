import type { DatabaseSync } from "node:sqlite";
import { ARENA_QUEUE_IDS, isArenaMatch, parseRiotMatch, type ParsedRiotMatch } from "./arena-match";
import { RiotApiClient, type RiotPlatform, type RiotRoutingRegion } from "./riot-api";

type Row = Record<string, unknown>;

export type CohortMember = {
  cohortId: string;
  puuid: string;
  platform: RiotPlatform;
  routingRegion: RiotRoutingRegion;
  gameName: string;
  tagLine: string;
  seedMethod: string;
  lastMatchStartMs: number | null;
};

export type IngestionSummary = {
  cohortId: string;
  puuid: string;
  requestedIds: number;
  alreadyStored: number;
  insertedMatches: number;
  insertedParticipants: number;
  ignoredNonArena: number;
  newestMatchStartMs: number | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function upsertCohortMember(
  db: DatabaseSync,
  member: Omit<CohortMember, "lastMatchStartMs">,
): void {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO cohort_members(
      cohort_id, puuid, platform, routing_region, game_name, tag_line, seed_method,
      active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(cohort_id, puuid) DO UPDATE SET
      platform=excluded.platform,
      routing_region=excluded.routing_region,
      game_name=CASE WHEN excluded.game_name <> '' THEN excluded.game_name ELSE cohort_members.game_name END,
      tag_line=CASE WHEN excluded.tag_line <> '' THEN excluded.tag_line ELSE cohort_members.tag_line END,
      seed_method=excluded.seed_method,
      active=1,
      updated_at=excluded.updated_at
  `).run(
    member.cohortId,
    member.puuid,
    member.platform,
    member.routingRegion,
    member.gameName,
    member.tagLine,
    member.seedMethod,
    timestamp,
    timestamp,
  );
}

export function cohortMembers(db: DatabaseSync, cohortId: string): CohortMember[] {
  return (db.prepare(`
    SELECT cohort_id, puuid, platform, routing_region, game_name, tag_line,
      seed_method, last_match_start_ms
    FROM cohort_members
    WHERE cohort_id = ? AND active = 1
    ORDER BY created_at, puuid
  `).all(cohortId) as Row[]).map((row) => ({
    cohortId: String(row.cohort_id),
    puuid: String(row.puuid),
    platform: String(row.platform) as RiotPlatform,
    routingRegion: String(row.routing_region) as RiotRoutingRegion,
    gameName: String(row.game_name ?? ""),
    tagLine: String(row.tag_line ?? ""),
    seedMethod: String(row.seed_method),
    lastMatchStartMs: row.last_match_start_ms == null ? null : Number(row.last_match_start_ms),
  }));
}

export function insertParsedMatch(db: DatabaseSync, match: ParsedRiotMatch, ingestedAt = nowIso()): boolean {
  db.exec("BEGIN");
  try {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO riot_matches(
        match_id, routing_region, platform, queue_id, game_mode, map_id, patch,
        game_version, started_at, duration_seconds, participant_count, raw_json,
        raw_json_hash, ingested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      match.matchId,
      match.routingRegion,
      match.platform,
      match.queueId,
      match.gameMode,
      match.mapId,
      match.patch,
      match.gameVersion,
      match.startedAt,
      match.durationSeconds,
      match.participantCount,
      match.rawJson,
      match.rawJsonHash,
      ingestedAt,
    );
    if (Number(inserted.changes) === 0) {
      db.exec("ROLLBACK");
      return false;
    }

    const insertParticipant = db.prepare(`
      INSERT INTO riot_participants(
        match_id, participant_index, puuid, puuid_hash, champion_id, champion_name,
        placement, subteam_id, won, augments_json, items_json, final_stats_json,
        raw_json, ingested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const participant of match.participants) {
      insertParticipant.run(
        match.matchId,
        participant.participantIndex,
        participant.puuid,
        participant.puuidHash,
        participant.championId,
        participant.championName,
        participant.placement,
        participant.subteamId,
        participant.won ? 1 : 0,
        JSON.stringify(participant.augmentIds),
        JSON.stringify(participant.itemIds),
        JSON.stringify(participant.finalStats),
        participant.rawJson,
        ingestedAt,
      );
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function addRiotIdToCohort(
  db: DatabaseSync,
  client: RiotApiClient,
  input: {
    cohortId: string;
    platform: RiotPlatform;
    routingRegion: RiotRoutingRegion;
    gameName: string;
    tagLine: string;
    seedMethod?: string;
  },
): Promise<CohortMember> {
  const account = await client.resolveAccount(input.routingRegion, input.gameName, input.tagLine);
  upsertCohortMember(db, {
    cohortId: input.cohortId,
    puuid: account.puuid,
    platform: input.platform,
    routingRegion: input.routingRegion,
    gameName: account.gameName ?? input.gameName,
    tagLine: account.tagLine ?? input.tagLine,
    seedMethod: input.seedMethod ?? "riot_id",
  });
  return cohortMembers(db, input.cohortId).find((member) => member.puuid === account.puuid)!;
}

export async function seedChallengerProxyCohort(
  db: DatabaseSync,
  client: RiotApiClient,
  input: { cohortId: string; platform: RiotPlatform; routingRegion: RiotRoutingRegion; limit: number },
): Promise<number> {
  const league = await client.challengerLeague(input.platform);
  let inserted = 0;
  for (const entry of (league.entries ?? []).slice(0, Math.max(0, input.limit))) {
    let puuid = entry.puuid ?? "";
    if (!puuid && entry.summonerId) puuid = (await client.summonerById(input.platform, entry.summonerId)).puuid ?? "";
    if (!puuid) continue;
    upsertCohortMember(db, {
      cohortId: input.cohortId,
      puuid,
      platform: input.platform,
      routingRegion: input.routingRegion,
      gameName: "",
      tagLine: "",
      seedMethod: "ranked_solo_challenger_proxy",
    });
    inserted += 1;
  }
  return inserted;
}

function updateCheckpoint(db: DatabaseSync, member: CohortMember, newestMatchStartMs: number | null): void {
  const timestamp = nowIso();
  db.prepare(`
    UPDATE cohort_members
    SET last_match_start_ms = CASE
        WHEN ? IS NULL THEN last_match_start_ms
        WHEN last_match_start_ms IS NULL OR ? > last_match_start_ms THEN ?
        ELSE last_match_start_ms
      END,
      last_checked_at = ?,
      updated_at = ?
    WHERE cohort_id = ? AND puuid = ?
  `).run(newestMatchStartMs, newestMatchStartMs, newestMatchStartMs, timestamp, timestamp, member.cohortId, member.puuid);
}

export async function ingestCohortMember(
  db: DatabaseSync,
  client: RiotApiClient,
  member: CohortMember,
  options: { count?: number; onMatchPayload?: (match: unknown) => Promise<void> | void } = {},
): Promise<IngestionSummary> {
  const targetCount = Math.min(Math.max(Math.trunc(options.count ?? 20), 1), 100);
  const startTimeSeconds = member.lastMatchStartMs
    ? Math.max(0, Math.floor(member.lastMatchStartMs / 1_000) - 3_600)
    : undefined;
  const matchIds: string[] = [];
  for (const queueId of [...ARENA_QUEUE_IDS].sort((left, right) => right - left)) {
    const remaining = targetCount - matchIds.length;
    if (remaining <= 0) break;
    const ids = await client.matchIds(member.routingRegion, member.puuid, { queueId, startTimeSeconds, count: remaining });
    for (const id of ids) if (!matchIds.includes(id)) matchIds.push(id);
  }
  // A mode can move to a new queue id before the static queue list catches up.
  // A bounded unfiltered fallback lets the payload's CHERRY marker identify it.
  if (matchIds.length < targetCount) {
    const fallbackIds = await client.matchIds(member.routingRegion, member.puuid, {
      startTimeSeconds,
      count: Math.min(100, Math.max(targetCount, (targetCount - matchIds.length) * 3)),
    });
    for (const id of fallbackIds) if (!matchIds.includes(id)) matchIds.push(id);
  }

  let alreadyStored = 0;
  let insertedMatches = 0;
  let insertedParticipants = 0;
  let ignoredNonArena = 0;
  let newestMatchStartMs = member.lastMatchStartMs;
  for (const matchId of matchIds) {
    if (db.prepare("SELECT 1 FROM riot_matches WHERE match_id = ?").get(matchId)) {
      alreadyStored += 1;
      continue;
    }
    const payload = await client.match(member.routingRegion, matchId);
    if (!isArenaMatch(payload)) {
      ignoredNonArena += 1;
      continue;
    }
    await options.onMatchPayload?.(payload);
    const parsed = parseRiotMatch(payload, { routingRegion: member.routingRegion, platform: member.platform });
    if (insertParsedMatch(db, parsed)) {
      insertedMatches += 1;
      insertedParticipants += parsed.participantCount;
    }
    newestMatchStartMs = Math.max(newestMatchStartMs ?? 0, parsed.startedAtMs);
  }
  updateCheckpoint(db, member, newestMatchStartMs);
  return {
    cohortId: member.cohortId,
    puuid: member.puuid,
    requestedIds: matchIds.length,
    alreadyStored,
    insertedMatches,
    insertedParticipants,
    ignoredNonArena,
    newestMatchStartMs,
  };
}
