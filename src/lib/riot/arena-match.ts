import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export const ARENA_QUEUE_IDS = new Set([1700, 1740]);

export type ParsedRiotParticipant = {
  participantIndex: number;
  puuid: string;
  puuidHash: string;
  championId: number;
  championName: string;
  placement: number | null;
  subteamId: number | null;
  won: boolean;
  augmentIds: number[];
  itemIds: number[];
  finalStats: Record<string, number | boolean>;
  rawJson: string;
};

export type ParsedRiotMatch = {
  matchId: string;
  routingRegion: string;
  platform: string;
  queueId: number;
  gameMode: string;
  mapId: number | null;
  patch: string;
  gameVersion: string;
  startedAt: string;
  startedAtMs: number;
  durationSeconds: number;
  participantCount: number;
  participants: ParsedRiotParticipant[];
  rawJson: string;
  rawJsonHash: string;
};

export class RiotMatchParseError extends Error {}

const FINAL_STAT_KEYS = [
  "champLevel",
  "kills",
  "deaths",
  "assists",
  "goldEarned",
  "goldSpent",
  "totalDamageDealt",
  "totalDamageDealtToChampions",
  "physicalDamageDealtToChampions",
  "magicDamageDealtToChampions",
  "trueDamageDealtToChampions",
  "totalDamageTaken",
  "damageSelfMitigated",
  "totalHeal",
  "totalHealsOnTeammates",
  "totalShieldedOnTeammates",
  "largestCriticalStrike",
  "largestKillingSpree",
  "longestTimeSpentLiving",
  "totalMinionsKilled",
  "neutralMinionsKilled",
  "win",
] as const;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function positiveIntegers(values: readonly unknown[]): number[] {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function patchFromVersion(version: string): string {
  const segments = version.split(".");
  return segments.length >= 2 ? `${segments[0]}.${segments[1]}` : version || "unknown";
}

function augmentIds(participant: JsonRecord): number[] {
  const numbered = Object.entries(participant)
    .filter(([key]) => /^playerAugment\d+$/i.test(key))
    .sort(([left], [right]) => Number(left.match(/\d+/)?.[0] ?? 0) - Number(right.match(/\d+/)?.[0] ?? 0))
    .map(([, value]) => value);
  const arrays = [participant.augments, participant.playerAugments]
    .filter(Array.isArray)
    .flatMap((value) => value as unknown[]);
  return positiveIntegers([...numbered, ...arrays]);
}

function itemIds(participant: JsonRecord): number[] {
  return positiveIntegers(Array.from({ length: 7 }, (_, index) => participant[`item${index}`]));
}

function finalStats(participant: JsonRecord): Record<string, number | boolean> {
  const output: Record<string, number | boolean> = {};
  for (const key of FINAL_STAT_KEYS) {
    const value = participant[key];
    if (typeof value === "boolean") output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  return output;
}

function parseParticipant(value: unknown, index: number): ParsedRiotParticipant {
  const participant = record(value) ?? {};
  const puuid = typeof participant.puuid === "string" ? participant.puuid : "";
  const placement = integer(participant.placement ?? participant.subteamPlacement);
  const participantIndex = integer(participant.participantId) ?? index + 1;
  const championId = integer(participant.championId) ?? 0;
  return {
    participantIndex,
    puuid,
    puuidHash: puuid ? createHash("sha256").update(puuid).digest("hex") : "",
    championId,
    championName: typeof participant.championName === "string" ? participant.championName : "",
    placement,
    subteamId: integer(participant.playerSubteamId ?? participant.subteamId),
    won: typeof participant.win === "boolean" ? participant.win : placement === 1,
    augmentIds: augmentIds(participant),
    itemIds: itemIds(participant),
    finalStats: finalStats(participant),
    rawJson: JSON.stringify(participant),
  };
}

export function isArenaMatch(value: unknown): boolean {
  const match = record(value);
  const info = record(match?.info);
  if (!info) return false;
  const queueId = integer(info.queueId) ?? 0;
  const gameMode = String(info.gameMode ?? "").toUpperCase();
  return ARENA_QUEUE_IDS.has(queueId) || gameMode === "CHERRY";
}

export function parseRiotMatch(
  value: unknown,
  context: { routingRegion: string; platform: string },
): ParsedRiotMatch {
  const match = record(value);
  const metadata = record(match?.metadata);
  const info = record(match?.info);
  const matchId = String(metadata?.matchId ?? "").trim();
  if (!match || !metadata || !info || !matchId) throw new RiotMatchParseError("Riot match payload is missing metadata, info, or matchId.");
  if (!isArenaMatch(match)) throw new RiotMatchParseError(`${matchId} is not an Arena match.`);

  const startedAtMs = integer(info.gameStartTimestamp ?? info.gameCreation) ?? 0;
  if (startedAtMs <= 0) throw new RiotMatchParseError(`${matchId} has no valid start timestamp.`);
  const rawDuration = Number(info.gameDuration ?? 0);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.round(rawDuration > 1_000_000 ? rawDuration / 1_000 : rawDuration)
    : 0;
  const participants = Array.isArray(info.participants)
    ? info.participants.map(parseParticipant)
    : [];
  const rawJson = JSON.stringify(match);
  const gameVersion = String(info.gameVersion ?? "unknown");

  return {
    matchId,
    routingRegion: context.routingRegion,
    platform: context.platform,
    queueId: integer(info.queueId) ?? 0,
    gameMode: String(info.gameMode ?? ""),
    mapId: integer(info.mapId),
    patch: patchFromVersion(gameVersion),
    gameVersion,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    durationSeconds,
    participantCount: participants.length,
    participants,
    rawJson,
    rawJsonHash: createHash("sha256").update(rawJson).digest("hex"),
  };
}
