import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "@/lib/schema";

type Row = Record<string, unknown>;

type Participant = {
  matchId: string;
  routingRegion: string;
  platform: string;
  patch: string;
  championId: number;
  augmentIds: number[];
  placement: number | null;
};

type Aggregate = {
  picks: number;
  first: number;
  top4: number;
  placementTotal: number;
  games: Set<string>;
};

export type MetaCalculationSummary = {
  matches: number;
  participants: number;
  snapshots: number;
  regions: string[];
  patches: string[];
};

function parseJson(value: unknown): unknown {
  try { return JSON.parse(String(value ?? "")); } catch { return null; }
}

function augmentIds(value: unknown): number[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? [...new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
}

function key(parts: readonly (string | number | null)[]): string {
  return parts.map((part) => part == null ? "" : String(part)).join("|");
}

function aggregateRow(map: Map<string, Aggregate>, aggregateKey: string, participant: Participant): void {
  const current = map.get(aggregateKey) ?? { picks: 0, first: 0, top4: 0, placementTotal: 0, games: new Set<string>() };
  current.picks += 1;
  current.first += participant.placement === 1 ? 1 : 0;
  current.top4 += participant.placement != null && participant.placement <= 4 ? 1 : 0;
  current.placementTotal += participant.placement ?? 0;
  current.games.add(participant.matchId);
  map.set(aggregateKey, current);
}

function rowsFor(db: DatabaseSync): Participant[] {
  const rows = db.prepare(`
    SELECT rp.match_id, rm.routing_region, rm.platform, rm.patch,
      rp.champion_id, rp.augments_json, rp.placement
    FROM riot_participants rp
    JOIN riot_matches rm ON rm.match_id = rp.match_id
    WHERE rm.queue_id IN (1700, 1740) OR upper(rm.game_mode) = 'CHERRY'
    ORDER BY rm.started_at
  `).all() as Row[];
  return rows.map((row) => ({
    matchId: String(row.match_id),
    routingRegion: String(row.routing_region),
    platform: String(row.platform),
    patch: String(row.patch),
    championId: Number(row.champion_id),
    augmentIds: augmentIds(row.augments_json),
    placement: row.placement == null ? null : Number(row.placement),
  }));
}

function insertMetric(
  insert: ReturnType<DatabaseSync["prepare"]>,
  context: { region: string; platform: string; patch: string; championId: number | null; entityKey: string; kind: "champion" | "augment" },
  aggregate: Aggregate,
  metric: string,
  value: number,
  now: string,
): void {
  insert.run({
    source: "riot_api_local",
    sourceUrl: "local://riot-match-v5",
    region: context.region,
    platform: context.platform,
    patch: context.patch,
    cohortId: "",
    metric,
    definition: metric === "win_rate" ? "first-place finishes / picks" : metric === "top4_rate" ? "placements 1-4 / picks" : "augment or champion appearances / all Arena participants",
    entityKey: context.entityKey,
    kind: context.kind,
    championId: context.championId,
    augmentSet: "[]",
    numerator: aggregate.first,
    denominator: aggregate.picks,
    value,
    averagePlacement: aggregate.picks ? aggregate.placementTotal / aggregate.picks : null,
    sampleSize: aggregate.games.size,
    generatedAt: now,
    details: JSON.stringify({ games: aggregate.games.size }),
  });
}

export function calculateMeta(databasePath = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite")): MetaCalculationSummary {
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA_SQL);
  const participants = rowsFor(db);
  const matches = new Set(participants.map((participant) => participant.matchId));
  const championNames = new Map((db.prepare("SELECT id, champion_key FROM champions").all() as Row[]).map((row) => [Number(row.id), String(row.champion_key)]));
  const totalByContext = new Map<string, number>();
  const championAggregates = new Map<string, Aggregate>();
  const augmentAggregates = new Map<string, Aggregate>();
  const championAugmentAggregates = new Map<string, Aggregate>();

  for (const participant of participants) {
    const contextKey = key([participant.routingRegion, participant.platform, participant.patch]);
    totalByContext.set(contextKey, (totalByContext.get(contextKey) ?? 0) + 1);
    const championKey = key([contextKey, participant.championId]);
    aggregateRow(championAggregates, championKey, participant);
    for (const augmentId of participant.augmentIds) {
      aggregateRow(augmentAggregates, key([contextKey, augmentId]), participant);
      aggregateRow(championAugmentAggregates, key([contextKey, participant.championId, augmentId]), participant);
    }
  }

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO meta_snapshots(
      source, source_url, region, platform, patch, cohort_id, metric, metric_definition,
      entity_key, kind, champion_id, augment_set_json, numerator, denominator, value,
      average_placement, sample_size, generated_at, details_json
    ) VALUES (@source, @sourceUrl, @region, @platform, @patch, @cohortId, @metric, @definition, @entityKey, @kind, @championId, @augmentSet, @numerator, @denominator, @value, @averagePlacement, @sampleSize, @generatedAt, @details)
  `);
  let snapshotCount = 0;
  db.exec("BEGIN");
  try {
    // Raw Riot rows remain immutable. Derived local aggregates are replaceable
    // projections, making repeated calculations idempotent and easy to audit.
    db.prepare("DELETE FROM meta_snapshots WHERE source = 'riot_api_local'").run();
    for (const [aggregateKey, aggregate] of championAggregates) {
      const [region, platform, patch, championIdText] = aggregateKey.split("|");
      const championId = Number(championIdText);
      const entityKey = `champion:${championNames.get(championId) ?? championId}`;
      const context = { region, platform, patch, championId: null, entityKey, kind: "champion" as const };
      insertMetric(insert, context, aggregate, "win_rate", aggregate.picks ? aggregate.first / aggregate.picks : 0, now);
      insertMetric(insert, context, aggregate, "top4_rate", aggregate.picks ? aggregate.top4 / aggregate.picks : 0, now);
      insertMetric(insert, context, aggregate, "pick_rate", (totalByContext.get(key([region, platform, patch])) ?? 0) ? aggregate.picks / (totalByContext.get(key([region, platform, patch])) ?? 1) : 0, now);
      snapshotCount += 3;
    }
    for (const [aggregateKey, aggregate] of augmentAggregates) {
      const [region, platform, patch, augmentId] = aggregateKey.split("|");
      const context = { region, platform, patch, championId: null, entityKey: `augment:${augmentId}`, kind: "augment" as const };
      insertMetric(insert, context, aggregate, "win_rate", aggregate.picks ? aggregate.first / aggregate.picks : 0, now);
      insertMetric(insert, context, aggregate, "top4_rate", aggregate.picks ? aggregate.top4 / aggregate.picks : 0, now);
      insertMetric(insert, context, aggregate, "pick_rate", (totalByContext.get(key([region, platform, patch])) ?? 0) ? aggregate.picks / (totalByContext.get(key([region, platform, patch])) ?? 1) : 0, now);
      snapshotCount += 3;
    }
    for (const [aggregateKey, aggregate] of championAugmentAggregates) {
      const [region, platform, patch, championId, augmentId] = aggregateKey.split("|");
      const context = { region, platform, patch, championId: Number(championId), entityKey: `champion:${championId}:augment:${augmentId}`, kind: "augment" as const };
      insertMetric(insert, context, aggregate, "win_rate", aggregate.picks ? aggregate.first / aggregate.picks : 0, now);
      insertMetric(insert, context, aggregate, "top4_rate", aggregate.picks ? aggregate.top4 / aggregate.picks : 0, now);
      snapshotCount += 2;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  return { matches: matches.size, participants: participants.length, snapshots: snapshotCount, regions: [...new Set(participants.map((row) => row.routingRegion))], patches: [...new Set(participants.map((row) => row.patch))] };
}

export function runMetaCalculation(): void {
  const databasePath = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
  if (!fs.existsSync(databasePath)) throw new Error(`Arena database was not found at ${databasePath}. Run npm run data:sync first.`);
  console.log(JSON.stringify(calculateMeta(databasePath), null, 2));
}
