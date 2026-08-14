export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS champions (
  id INTEGER PRIMARY KEY,
  champion_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  partype TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  icon_url TEXT NOT NULL,
  patch TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  entity_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('augment', 'item')),
  numeric_id INTEGER NOT NULL,
  api_name TEXT NOT NULL,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  description TEXT NOT NULL,
  tooltip TEXT NOT NULL,
  icon_url TEXT NOT NULL,
  purchasable INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL,
  produces_json TEXT NOT NULL,
  consumes_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  patch TEXT NOT NULL,
  source_url TEXT NOT NULL,
  UNIQUE(kind, numeric_id)
);

CREATE INDEX IF NOT EXISTS entities_kind_name_idx ON entities(kind, name);
CREATE INDEX IF NOT EXISTS entities_numeric_id_idx ON entities(numeric_id);

CREATE TABLE IF NOT EXISTS mechanic_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key TEXT NOT NULL REFERENCES entities(entity_key) ON DELETE CASCADE,
  source_stat TEXT NOT NULL,
  target_stat TEXT NOT NULL,
  operation TEXT NOT NULL,
  coefficient_json TEXT NOT NULL,
  conditions TEXT NOT NULL,
  confidence REAL NOT NULL,
  patch TEXT NOT NULL,
  source_url TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS mechanic_edges_entity_idx ON mechanic_edges(entity_key);
CREATE INDEX IF NOT EXISTS mechanic_edges_stats_idx ON mechanic_edges(source_stat, target_stat);

CREATE TABLE IF NOT EXISTS combos (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  entity_keys_json TEXT NOT NULL,
  champion_tags_json TEXT NOT NULL,
  goal_tags_json TEXT NOT NULL,
  score INTEGER NOT NULL,
  evidence_url TEXT NOT NULL,
  evidence_note TEXT NOT NULL,
  patch TEXT NOT NULL,
  generated INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'curated' CHECK (origin IN ('curated', 'video', 'generated'))
);

CREATE INDEX IF NOT EXISTS combos_score_idx ON combos(score DESC);

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  transcript_status TEXT NOT NULL DEFAULT 'not_requested',
  transcript_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  catalog_position INTEGER NOT NULL DEFAULT 0,
  scraped_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS videos_published_idx ON videos(published_at DESC);

CREATE TABLE IF NOT EXISTS video_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  entity_key TEXT NOT NULL REFERENCES entities(entity_key) ON DELETE CASCADE,
  source TEXT NOT NULL,
  timestamp_seconds REAL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  UNIQUE(video_id, entity_key, source, timestamp_seconds)
);

CREATE INDEX IF NOT EXISTS video_mentions_video_idx ON video_mentions(video_id);
CREATE INDEX IF NOT EXISTS video_mentions_entity_idx ON video_mentions(entity_key);

CREATE TABLE IF NOT EXISTS video_champions (
  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  champion_id INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY(video_id, champion_id, source)
);

CREATE INDEX IF NOT EXISTS video_champions_video_idx ON video_champions(video_id);
CREATE INDEX IF NOT EXISTS video_champions_champion_idx ON video_champions(champion_id);

CREATE TABLE IF NOT EXISTS personal_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  played_at TEXT NOT NULL,
  patch TEXT NOT NULL,
  champion_id INTEGER NOT NULL REFERENCES champions(id),
  placement INTEGER NOT NULL CHECK (placement BETWEEN 1 AND 16),
  team_count INTEGER NOT NULL DEFAULT 8 CHECK (team_count BETWEEN 2 AND 16),
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'riot', 'client')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS personal_runs_played_idx ON personal_runs(played_at DESC);
CREATE INDEX IF NOT EXISTS personal_runs_champion_idx ON personal_runs(champion_id);

CREATE TABLE IF NOT EXISTS personal_run_entities (
  run_id INTEGER NOT NULL REFERENCES personal_runs(id) ON DELETE CASCADE,
  entity_key TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('augment', 'item')),
  icon_url TEXT NOT NULL,
  rarity TEXT NOT NULL,
  pick_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(run_id, entity_key)
);

CREATE INDEX IF NOT EXISTS personal_run_entities_entity_idx ON personal_run_entities(entity_key);

CREATE TABLE IF NOT EXISTS extreme_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  champion_key TEXT NOT NULL,
  champion_name TEXT NOT NULL,
  level INTEGER NOT NULL,
  objective TEXT NOT NULL,
  result_rank INTEGER NOT NULL,
  score REAL NOT NULL,
  theoretical_unbounded INTEGER NOT NULL DEFAULT 0,
  unbounded_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  augment_keys_json TEXT NOT NULL,
  augments_json TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  scenario_json TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  delta REAL NOT NULL,
  patch TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  UNIQUE(champion_key, objective, result_rank, scenario_name, patch)
);

CREATE INDEX IF NOT EXISTS extreme_builds_lookup_idx
ON extreme_builds(objective, champion_key, scenario_name, result_rank);

CREATE TABLE IF NOT EXISTS arena_meta (
  entity_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('champion', 'augment')),
  tier TEXT NOT NULL DEFAULT '',
  win_rate REAL,
  pick_rate REAL,
  patch TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS arena_meta_kind_idx ON arena_meta(kind, tier, pick_rate DESC);

-- Immutable Riot API warehouse. Raw match rows are never rewritten by a meta
-- calculation; derived observations point back to their source population.
CREATE TABLE IF NOT EXISTS riot_matches (
  match_id TEXT PRIMARY KEY,
  routing_region TEXT NOT NULL,
  platform TEXT NOT NULL,
  queue_id INTEGER NOT NULL,
  game_mode TEXT NOT NULL,
  map_id INTEGER,
  patch TEXT NOT NULL,
  game_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  participant_count INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  raw_json_hash TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS riot_matches_region_started_idx
ON riot_matches(routing_region, started_at DESC);
CREATE INDEX IF NOT EXISTS riot_matches_patch_queue_idx
ON riot_matches(patch, queue_id, game_mode);

CREATE TABLE IF NOT EXISTS riot_participants (
  match_id TEXT NOT NULL REFERENCES riot_matches(match_id) ON DELETE CASCADE,
  participant_index INTEGER NOT NULL,
  puuid TEXT NOT NULL DEFAULT '',
  puuid_hash TEXT NOT NULL DEFAULT '',
  champion_id INTEGER NOT NULL,
  champion_name TEXT NOT NULL DEFAULT '',
  placement INTEGER,
  subteam_id INTEGER,
  won INTEGER NOT NULL DEFAULT 0 CHECK (won IN (0, 1)),
  augments_json TEXT NOT NULL DEFAULT '[]',
  items_json TEXT NOT NULL DEFAULT '[]',
  final_stats_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL DEFAULT '{}',
  ingested_at TEXT NOT NULL,
  PRIMARY KEY(match_id, participant_index)
);

CREATE INDEX IF NOT EXISTS riot_participants_puuid_idx
ON riot_participants(puuid, match_id);
CREATE INDEX IF NOT EXISTS riot_participants_champion_idx
ON riot_participants(champion_id, placement);

-- Query projection derived from immutable riot_participants. The JSON column
-- remains authoritative; this table makes champion + augment intersections fast.
CREATE TABLE IF NOT EXISTS participant_augments (
  match_id TEXT NOT NULL,
  participant_index INTEGER NOT NULL,
  augment_id INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  PRIMARY KEY(match_id, participant_index, augment_id),
  FOREIGN KEY(match_id, participant_index)
    REFERENCES riot_participants(match_id, participant_index) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS participant_augments_lookup_idx
ON participant_augments(augment_id, match_id, participant_index);

CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  platform TEXT NOT NULL,
  routing_region TEXT NOT NULL,
  game_name TEXT NOT NULL DEFAULT '',
  tag_line TEXT NOT NULL DEFAULT '',
  seed_method TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_match_start_ms INTEGER,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(cohort_id, puuid)
);

CREATE INDEX IF NOT EXISTS cohort_members_active_idx
ON cohort_members(cohort_id, active, platform);

CREATE TABLE IF NOT EXISTS pro_players (
  puuid TEXT PRIMARY KEY,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  display_name TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pro_players_region_idx
ON pro_players(region, team, display_name);

CREATE TABLE IF NOT EXISTS followed_players (
  puuid TEXT PRIMARY KEY REFERENCES pro_players(puuid) ON DELETE CASCADE,
  notify_new_match INTEGER NOT NULL DEFAULT 1 CHECK (notify_new_match IN (0, 1)),
  followed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participant_item_events (
  match_id TEXT NOT NULL,
  participant_index INTEGER NOT NULL,
  sequence_index INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  PRIMARY KEY(match_id, participant_index, sequence_index),
  FOREIGN KEY(match_id, participant_index)
    REFERENCES riot_participants(match_id, participant_index) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS participant_item_events_path_idx
ON participant_item_events(match_id, participant_index, timestamp_ms, sequence_index);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
ON notification_outbox(delivered_at, created_at);

CREATE TABLE IF NOT EXISTS meta_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  patch TEXT NOT NULL,
  cohort_id TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL,
  metric_definition TEXT NOT NULL,
  entity_key TEXT,
  kind TEXT CHECK (kind IS NULL OR kind IN ('champion', 'augment', 'item', 'augment_combo')),
  champion_id INTEGER,
  augment_set_json TEXT NOT NULL DEFAULT '[]',
  numerator REAL,
  denominator REAL,
  value REAL,
  average_placement REAL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS meta_snapshots_lookup_idx
ON meta_snapshots(source, region, patch, metric, champion_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS meta_snapshots_entity_idx
ON meta_snapshots(entity_key, metric, generated_at DESC);

CREATE TABLE IF NOT EXISTS live_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puuid TEXT NOT NULL DEFAULT '',
  champion_id INTEGER,
  champion_name TEXT NOT NULL DEFAULT '',
  augment_ids_json TEXT NOT NULL DEFAULT '[]',
  observed_max_hp REAL NOT NULL DEFAULT 0,
  observed_max_ad REAL NOT NULL DEFAULT 0,
  observed_max_ap REAL NOT NULL DEFAULT 0,
  observed_max_as REAL NOT NULL DEFAULT 0,
  observed_max_armor REAL NOT NULL DEFAULT 0,
  observed_max_mr REAL NOT NULL DEFAULT 0,
  observed_max_ms REAL NOT NULL DEFAULT 0,
  observed_max_haste REAL NOT NULL DEFAULT 0,
  queue_id INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live_client',
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS live_observations_champion_idx
ON live_observations(champion_id, observed_max_hp DESC);

-- Future UI consumers can opt into this view without changing or replacing the
-- current arena_meta table. Each derived source keeps its own provenance row.
CREATE VIEW IF NOT EXISTS arena_meta_all_sources AS
SELECT entity_key, kind, tier, win_rate, pick_rate, patch, source_name,
  source_url, fetched_at, extra_json
FROM arena_meta
UNION ALL
SELECT
  entity_key,
  COALESCE(kind, 'augment') AS kind,
  '' AS tier,
  MAX(CASE WHEN metric IN ('win_rate', 'first_place_rate', 'top_half_rate', 'top3_rate') THEN value END) AS win_rate,
  MAX(CASE WHEN metric = 'pick_rate' THEN value END) AS pick_rate,
  patch,
  source AS source_name,
  MAX(source_url) AS source_url,
  MAX(generated_at) AS fetched_at,
  json_object(
    'region', region,
    'platform', platform,
    'cohortId', cohort_id,
    'sampleSize', MAX(sample_size),
    'metricDefinition', MAX(metric_definition)
  ) AS extra_json
FROM meta_snapshots
WHERE entity_key IS NOT NULL AND kind IN ('champion', 'augment')
GROUP BY entity_key, kind, patch, source, region, platform, cohort_id;
`;
