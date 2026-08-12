import "server-only";

import { getDatabase } from "@/lib/db";

type Row = Record<string, unknown>;

export type StoredExtremeBuild = {
  id: number;
  championKey: string;
  championName: string;
  level: number;
  objective: string;
  rank: number;
  score: number;
  theoreticalUnbounded: boolean;
  unboundedReason: string;
  status: string;
  stats: Record<string, number>;
  effectKeys: string[];
  effects: Array<{ key: string; name: string; kind: "augment" | "item" | "scenario"; rank: number; rarity: string }>;
  scenarioName: string;
  scenario: Record<string, unknown>;
  iterations: number;
  delta: number;
  patch: string;
  generatedAt: string;
};

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function mapBuild(row: Row): StoredExtremeBuild {
  return {
    id: Number(row.id),
    championKey: String(row.champion_key),
    championName: String(row.champion_name),
    level: Number(row.level),
    objective: String(row.objective),
    rank: Number(row.result_rank),
    score: Number(row.score),
    theoreticalUnbounded: Boolean(row.theoretical_unbounded),
    unboundedReason: String(row.unbounded_reason),
    status: String(row.status),
    stats: parseJson(row.stats_json, {}),
    effectKeys: parseJson(row.augment_keys_json, []),
    effects: parseJson(row.augments_json, []),
    scenarioName: String(row.scenario_name),
    scenario: parseJson(row.scenario_json, {}),
    iterations: Number(row.iterations),
    delta: Number(row.delta),
    patch: String(row.patch),
    generatedAt: String(row.generated_at),
  };
}

export function queryExtremeBuilds(options: { champion?: string; objective?: string; scenario?: string; limit?: number }): StoredExtremeBuild[] {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  const rows = getDatabase().prepare(`
    SELECT * FROM extreme_builds
    WHERE patch = COALESCE((SELECT value FROM metadata WHERE key = 'patch'), patch)
      AND (? = '' OR lower(champion_key) = lower(?) OR lower(champion_name) = lower(?))
      AND (? = '' OR objective = ?)
      AND (? = '' OR scenario_name = ?)
    ORDER BY theoretical_unbounded DESC, score DESC, champion_name, objective, result_rank
    LIMIT ?
  `).all(
    options.champion ?? "", options.champion ?? "", options.champion ?? "",
    options.objective ?? "", options.objective ?? "",
    options.scenario ?? "", options.scenario ?? "",
    limit,
  ) as Row[];
  return rows.map(mapBuild);
}
