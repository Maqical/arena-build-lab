import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";
import { rebuildVideoCombos } from "../src/lib/video-combos";
import { extractVideoStatClaims } from "../src/lib/video-stat-claims";

/**
 * Packaged-app worker (build-workers/seed-videos.cjs): imports the bundled
 * video catalog seed into the AppData database on first run so the Video
 * evidence tab works without a live YouTube sync. Idempotent: exits early
 * when the videos table already has rows. Remaps seed champion_key rows
 * onto the target DB's champions.id and drops mentions whose entity keys
 * are not in the local catalog.
 */
const seedPath = path.resolve(process.cwd(), process.env.ARENA_VIDEO_SEED_PATH ?? "data/videos.seed.sqlite");
const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
if (!fs.existsSync(seedPath)) {
  console.log(JSON.stringify({ seeded: 0, skipped: "seed-missing", database: filename }));
  process.exit(0);
}

const db = new DatabaseSync(filename);
db.exec(SCHEMA_SQL);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("PRAGMA foreign_keys = OFF");

const existing = db.prepare("SELECT COUNT(*) AS count FROM videos").get() as { count: number };
if (Number(existing.count) > 0) {
  console.log(JSON.stringify({ seeded: 0, skipped: "videos-present", database: filename }));
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
db.exec("PRAGMA foreign_keys = ON");
console.log(JSON.stringify({ seeded: Number(db.prepare("SELECT COUNT(*) AS count FROM videos").get()?.count ?? 0), combos, claims: claims.inserted, database: filename }, null, 2));
db.close();
