import "server-only";

import { getDatabase, hasLocalMetaSnapshots } from "@/lib/db";
import type { ArenaMetaRecord, OverlayCatalogEntity } from "@/lib/live-overlay-types";

type Row = Record<string, unknown>;

export function getOverlayCatalog(): OverlayCatalogEntity[] {
  return (getDatabase().prepare(`
    SELECT entity_key, numeric_id, api_name, name, kind, rarity, description, icon_url
    FROM entities WHERE trim(name) <> '' ORDER BY kind, name
  `).all() as Row[]).map((row) => ({
    entityKey: String(row.entity_key),
    numericId: Number(row.numeric_id),
    apiName: String(row.api_name ?? ""),
    name: String(row.name),
    kind: String(row.kind) as OverlayCatalogEntity["kind"],
    rarity: String(row.rarity),
    description: String(row.description ?? ""),
    iconUrl: String(row.icon_url ?? ""),
  }));
}

export function getArenaMeta(): ArenaMetaRecord[] {
  const db = getDatabase();
  const localRows = hasLocalMetaSnapshots() ? db.prepare(`
    SELECT entity_key, kind, patch, region, platform, generated_at,
      MAX(CASE WHEN metric = 'win_rate' THEN value END) AS win_rate,
      MAX(CASE WHEN metric = 'pick_rate' THEN value END) AS pick_rate,
      MAX(sample_size) AS sample_size,
      MAX(metric_definition) AS metric_definition
    FROM meta_snapshots
    WHERE source = 'riot_api_local' AND champion_id IS NULL
    GROUP BY entity_key, kind, patch, region, platform
    ORDER BY kind, pick_rate DESC
  `).all() as Row[] : [];
  const rows = localRows.length > 0 ? localRows : db.prepare("SELECT * FROM arena_meta ORDER BY kind, tier, pick_rate DESC").all() as Row[];
  return rows.map((row) => ({
    entityKey: String(row.entity_key),
    kind: String(row.kind) as ArenaMetaRecord["kind"],
    tier: String(row.tier ?? ""),
    winRate: row.win_rate == null ? null : Number(row.win_rate),
    pickRate: row.pick_rate == null ? null : Number(row.pick_rate),
    patch: String(row.patch ?? ""),
    sourceName: String(row.source_name ?? "riot_api_local"),
    sourceUrl: String(row.source_url ?? "local://riot-match-v5"),
    fetchedAt: String(row.fetched_at ?? row.generated_at ?? ""),
    region: row.region == null ? undefined : String(row.region),
    platform: row.platform == null ? undefined : String(row.platform),
    sampleSize: row.sample_size == null ? undefined : Number(row.sample_size),
    metricDefinition: row.metric_definition == null ? undefined : String(row.metric_definition),
  }));
}
