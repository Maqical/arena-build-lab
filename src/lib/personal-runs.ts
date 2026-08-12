import "server-only";

import { getDatabase } from "@/lib/db";
import type { EntityKind, PersonalEntityPerformance, PersonalRun, PersonalStats } from "@/lib/types";

type RunInput = {
  playedAt?: unknown;
  championId?: unknown;
  placement?: unknown;
  teamCount?: unknown;
  notes?: unknown;
  entityKeys?: unknown;
};

type Row = Record<string, unknown>;

export class PersonalRunValidationError extends Error {}

function integer(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new PersonalRunValidationError(`${field} must be a whole number.`);
  return parsed;
}

function mapRun(row: Row): PersonalRun {
  const db = getDatabase();
  const entities = db.prepare(`
    SELECT entity_key, entity_name, entity_kind, icon_url, rarity, pick_order
    FROM personal_run_entities WHERE run_id = ? ORDER BY pick_order, entity_name
  `).all(Number(row.id)) as Row[];
  return {
    id: Number(row.id),
    playedAt: String(row.played_at),
    patch: String(row.patch),
    champion: {
      id: Number(row.champion_id),
      key: String(row.champion_key),
      name: String(row.champion_name),
      iconUrl: String(row.champion_icon_url),
    },
    placement: Number(row.placement),
    teamCount: Number(row.team_count),
    notes: String(row.notes ?? ""),
    source: String(row.source) as PersonalRun["source"],
    entities: entities.map((entity) => ({
      entityKey: String(entity.entity_key),
      name: String(entity.entity_name),
      kind: String(entity.entity_kind) as EntityKind,
      iconUrl: String(entity.icon_url),
      rarity: String(entity.rarity),
      pickOrder: Number(entity.pick_order),
    })),
  };
}

export function getPersonalRuns(limit = 50, championId?: number): PersonalRun[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 250);
  const rows = getDatabase().prepare(`
    SELECT pr.*, c.champion_key, c.name AS champion_name, c.icon_url AS champion_icon_url
    FROM personal_runs pr JOIN champions c ON c.id = pr.champion_id
    WHERE (? IS NULL OR pr.champion_id = ?)
    ORDER BY pr.played_at DESC, pr.id DESC LIMIT ?
  `).all(championId ?? null, championId ?? null, safeLimit) as Row[];
  return rows.map(mapRun);
}

export function getPersonalStats(championId?: number): PersonalStats {
  const db = getDatabase();
  const aggregate = db.prepare(`
    SELECT COUNT(*) AS games,
      COALESCE(SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(AVG(placement), 0) AS average_placement,
      COALESCE(AVG(CASE WHEN placement <= ((team_count + 1) / 2) THEN 1.0 ELSE 0.0 END), 0) AS top_half_rate
    FROM personal_runs WHERE (? IS NULL OR champion_id = ?)
  `).get(championId ?? null, championId ?? null) as Row;
  const games = Number(aggregate.games);
  const performanceRows = db.prepare(`
    SELECT pre.entity_key, pre.entity_name, pre.entity_kind, pre.icon_url,
      COUNT(*) AS games,
      SUM(CASE WHEN pr.placement = 1 THEN 1 ELSE 0 END) AS wins,
      AVG(CASE WHEN pr.placement <= ((pr.team_count + 1) / 2) THEN 1.0 ELSE 0.0 END) AS top_half_rate,
      AVG(pr.placement) AS average_placement
    FROM personal_run_entities pre
    JOIN personal_runs pr ON pr.id = pre.run_id
    WHERE (? IS NULL OR pr.champion_id = ?)
    GROUP BY pre.entity_key, pre.entity_name, pre.entity_kind, pre.icon_url
    ORDER BY games DESC, average_placement ASC, pre.entity_name
    LIMIT 100
  `).all(championId ?? null, championId ?? null) as Row[];
  const entityPerformance: PersonalEntityPerformance[] = performanceRows.map((row) => ({
    entityKey: String(row.entity_key),
    name: String(row.entity_name),
    kind: String(row.entity_kind) as EntityKind,
    iconUrl: String(row.icon_url),
    games: Number(row.games),
    wins: Number(row.wins),
    winRate: Number(row.games) ? Number(row.wins) / Number(row.games) : 0,
    topHalfRate: Number(row.top_half_rate),
    averagePlacement: Number(row.average_placement),
  }));
  return {
    totalRuns: games,
    wins: Number(aggregate.wins),
    winRate: games ? Number(aggregate.wins) / games : 0,
    topHalfRate: Number(aggregate.top_half_rate),
    averagePlacement: Number(aggregate.average_placement),
    entityPerformance,
  };
}

export function createPersonalRun(input: RunInput): PersonalRun {
  const db = getDatabase();
  const championId = integer(input.championId, "Champion");
  const placement = integer(input.placement, "Placement");
  const teamCount = integer(input.teamCount ?? 8, "Team count");
  if (teamCount < 2 || teamCount > 16) throw new PersonalRunValidationError("Team count must be between 2 and 16.");
  if (placement < 1 || placement > teamCount) throw new PersonalRunValidationError("Placement must be within the number of teams.");
  if (!db.prepare("SELECT 1 FROM champions WHERE id = ?").get(championId)) throw new PersonalRunValidationError("Champion was not found.");

  const playedAt = typeof input.playedAt === "string" && input.playedAt ? new Date(input.playedAt) : new Date();
  if (Number.isNaN(playedAt.getTime())) throw new PersonalRunValidationError("Played-at date is invalid.");
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) : "";
  const rawEntityKeys = Array.isArray(input.entityKeys) ? input.entityKeys : [];
  const entityKeys = [...new Set(rawEntityKeys.filter((key): key is string => typeof key === "string" && key.length > 0))].slice(0, 24);
  const entityRows = entityKeys.map((key) => db.prepare("SELECT entity_key, name, kind, icon_url, rarity FROM entities WHERE entity_key = ?").get(key) as Row | undefined);
  if (entityRows.some((row) => !row)) throw new PersonalRunValidationError("One or more items or augments were not found.");
  const patch = String((db.prepare("SELECT value FROM metadata WHERE key = 'patch'").get() as Row | undefined)?.value ?? "unknown");
  let id = 0;
  db.exec("BEGIN");
  try {
    const result = db.prepare(`
      INSERT INTO personal_runs(played_at, patch, champion_id, placement, team_count, notes, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
    `).run(playedAt.toISOString(), patch, championId, placement, teamCount, notes, new Date().toISOString());
    id = Number(result.lastInsertRowid);
    const insertEntity = db.prepare(`
      INSERT INTO personal_run_entities(run_id, entity_key, entity_name, entity_kind, icon_url, rarity, pick_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    entityRows.forEach((entity, index) => {
      if (entity) insertEntity.run(
        id,
        String(entity.entity_key),
        String(entity.name),
        String(entity.kind),
        String(entity.icon_url),
        String(entity.rarity),
        index,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const row = db.prepare(`
    SELECT pr.*, c.champion_key, c.name AS champion_name, c.icon_url AS champion_icon_url
    FROM personal_runs pr JOIN champions c ON c.id = pr.champion_id WHERE pr.id = ?
  `).get(id) as Row;
  return mapRun(row);
}

export function deletePersonalRun(id: number): boolean {
  if (!Number.isInteger(id) || id <= 0) throw new PersonalRunValidationError("Run id is invalid.");
  return Number(getDatabase().prepare("DELETE FROM personal_runs WHERE id = ?").run(id).changes) > 0;
}
