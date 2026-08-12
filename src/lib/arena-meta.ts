import "server-only";

import { getDatabase } from "@/lib/db";
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
  return (getDatabase().prepare("SELECT * FROM arena_meta ORDER BY kind, tier, pick_rate DESC").all() as Row[]).map((row) => ({
    entityKey: String(row.entity_key),
    kind: String(row.kind) as ArenaMetaRecord["kind"],
    tier: String(row.tier ?? ""),
    winRate: row.win_rate == null ? null : Number(row.win_rate),
    pickRate: row.pick_rate == null ? null : Number(row.pick_rate),
    patch: String(row.patch ?? ""),
    sourceName: String(row.source_name ?? ""),
    sourceUrl: String(row.source_url ?? ""),
    fetchedAt: String(row.fetched_at ?? ""),
  }));
}
