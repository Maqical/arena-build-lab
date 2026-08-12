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
`;
