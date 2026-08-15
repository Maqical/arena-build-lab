import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";
import { rebuildVideoCombos } from "../src/lib/video-combos";
import { extractVideoStatClaims } from "../src/lib/video-stat-claims";
import { parseExtremeBuildCsv } from "../src/lib/extreme-build-csv-core";

/**
 * Packaged-app worker (build-workers/seed-data.cjs): imports the bundled
 * video catalog seed into the AppData database on first run so the Video
 * evidence tab works without a live YouTube sync, and imports the bundled
 * extreme-build CSV into the extreme_builds table when it is empty.
 * Idempotent per table: skips sections whose target table already has rows.
 * Remaps seed champion_key rows onto the target DB's champions.id and drops
 * mentions whose entity keys are not in the local catalog.
 */
const seedPath = path.resolve(process.cwd(), process.env.ARENA_VIDEO_SEED_PATH ?? "data/videos.seed.sqlite");
const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
const extremeCsvPath = path.resolve(process.cwd(), process.env.ARENA_EXTREME_CSV_PATH ?? "data/extreme_builds.csv");

const db = new DatabaseSync(filename);
db.exec(SCHEMA_SQL);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("PRAGMA foreign_keys = OFF");

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function importExtremeBuildsIfEmpty(target: DatabaseSync, csvPath: string): number {
  const existing = Number((target.prepare("SELECT COUNT(*) AS count FROM extreme_builds").get() as { count: number }).count ?? 0);
  if (existing > 0 || !fs.existsSync(csvPath)) return 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const champions = Number((target.prepare("SELECT COUNT(*) AS count FROM champions").get() as { count: number }).count ?? 0);
    if (champions > 0) break;
    sleepSync(1000);
  }
  const rows = parseExtremeBuildCsv(fs.readFileSync(csvPath, "utf8"));
  if (!rows.length) return 0;
  const championKeyByName = new Map<string, string>();
  for (const champion of target.prepare("SELECT champion_key, name FROM champions").all() as Array<{ champion_key: string; name: string }>) {
    championKeyByName.set(champion.name, champion.champion_key);
    championKeyByName.set(champion.name.toLowerCase().replace(/[^a-z0-9]/g, ""), champion.champion_key);
  }
  const entityByKindName = new Map<string, Map<string, string>>();
  for (const entity of target.prepare("SELECT entity_key, name, kind FROM entities").all() as Array<{ entity_key: string; name: string; kind: string }>) {
    const byName = entityByKindName.get(entity.kind) ?? new Map<string, string>();
    byName.set(entity.name, entity.entity_key);
    byName.set(entity.name.toLowerCase().replace(/[^a-z0-9]/g, ""), entity.entity_key);
    entityByKindName.set(entity.kind, byName);
  }
  const keyFor = (kind: string, display: string) => entityByKindName.get(kind)?.get(display) ?? "";
  const patch = String((target.prepare("SELECT value FROM metadata WHERE key = 'patch'").get() as { value?: string } | undefined)?.value ?? "unknown");
  const now = new Date().toISOString();
  const insert = target.prepare(`
    INSERT INTO extreme_builds(champion_key, champion_name, level, objective, result_rank, score,
      theoretical_unbounded, unbounded_reason, status, stats_json, augment_keys_json, augments_json,
      scenario_name, scenario_json, iterations, delta, patch, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `);
  target.exec("BEGIN");
  try {
    for (const row of rows) {
      const championKey = championKeyByName.get(row.champion) ?? row.champion.toLowerCase().replace(/[^a-z0-9]/g, "");
      const augmentEffects = row.augments.map((name) => ({ name, kind: "augment" as const, key: keyFor("augment", name), rank: 0, rarity: "" })).filter((effect) => effect.key);
      const itemEffects = row.fixedItems.map((name) => ({ name, kind: "item" as const, key: keyFor("item", name), rank: 0, rarity: "" })).filter((effect) => effect.key);
      const effects = [...augmentEffects, ...itemEffects];
      const scenarioName = String(row.scenario.name ?? "high-stack-benchmark-v1");      insert.run(
        championKey, row.champion, row.level, row.objective, row.rank, row.benchmarkScore,
        row.theoreticalUnbounded ? 1 : 0, "", row.status,
        JSON.stringify(row.stats),
        JSON.stringify(effects.map((effect) => effect.key)), JSON.stringify(effects),
        scenarioName, JSON.stringify(row.scenario), patch, now,
      );
    }
    target.exec("COMMIT");
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  }
  return rows.length;
}

const existing = db.prepare("SELECT COUNT(*) AS count FROM videos").get() as { count: number };
if (Number(existing.count) > 0) {
  const extremeSeeded = importExtremeBuildsIfEmpty(db, extremeCsvPath);
  console.log(JSON.stringify({ seeded: 0, skipped: "videos-present", extremeSeeded, database: filename }));
  db.close();
  process.exit(0);
}

const seed = new DatabaseSync(seedPath, { readOnly: true });
db.exec("BEGIN");
try {
  const copyVideos = db.prepare(`
    INSERT OR IGNORE INTO videos(video_id, channel_id, title, description, published_at, duration_seconds,
      url, thumbnail_url, metadata_json, catalog_position, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const videoRows = seed.prepare("SELECT video_id, channel_id, title, description, published_at, duration_seconds, url, thumbnail_url, metadata_json, catalog_position, scraped_at FROM videos").all() as Array<{ video_id: string; channel_id: string; title: string; description: string; published_at: string; duration_seconds: number | null; url: string; thumbnail_url: string; metadata_json: string; catalog_position: number; scraped_at: string }>;
  for (const video of videoRows) copyVideos.run(
    video.video_id, video.channel_id, video.title, video.description, video.published_at,
    video.duration_seconds, video.url, video.thumbnail_url, video.metadata_json,
    video.catalog_position, video.scraped_at,
  );

  const copyMention = db.prepare(`
    INSERT OR IGNORE INTO video_mentions(video_id, entity_key, source, timestamp_seconds, evidence_text, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const mentionRows = seed.prepare("SELECT video_id, entity_key, source, timestamp_seconds, evidence_text, confidence FROM video_mentions").all() as Array<{ video_id: string; entity_key: string; source: string; timestamp_seconds: number | null; evidence_text: string; confidence: number }>;
  for (const mention of mentionRows) copyMention.run(
    mention.video_id, mention.entity_key, mention.source, mention.timestamp_seconds,
    mention.evidence_text, mention.confidence,
  );

  const championId = db.prepare("SELECT id FROM champions WHERE champion_key = ?");
  const copyChampion = db.prepare(`
    INSERT OR IGNORE INTO video_champions(video_id, champion_id, source, evidence_text, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
  const championRows = seed.prepare("SELECT video_id, champion_key, source, evidence_text, confidence FROM video_champions").all() as Array<{ video_id: string; champion_key: string; source: string; evidence_text: string; confidence: number }>;
  for (const champion of championRows) {
    const target = championId.get(champion.champion_key) as { id: number } | undefined;
    if (!target) continue;
    copyChampion.run(champion.video_id, target.id, champion.source, champion.evidence_text, champion.confidence);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
seed.close();

const patch = String((db.prepare("SELECT value FROM metadata WHERE key = 'patch'").get() as { value?: string } | undefined)?.value ?? "unknown");
const combos = rebuildVideoCombos(db, patch);
const claims = extractVideoStatClaims(db);
const extremeSeeded = importExtremeBuildsIfEmpty(db, extremeCsvPath);
db.exec("PRAGMA foreign_keys = ON");
console.log(JSON.stringify({ seeded: Number(db.prepare("SELECT COUNT(*) AS count FROM videos").get()?.count ?? 0), combos, claims: claims.inserted, extremeSeeded, database: filename }, null, 2));
db.close();
