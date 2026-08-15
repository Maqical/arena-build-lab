import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Build the lean video-catalog seed consumed by the packaged app's
 * seed-videos worker. Reads the dev database and writes only the video
 * tables (no transcripts) to build-workers/videos.seed.sqlite so a fresh
 * install has the full King NidHogg catalog without a live YouTube sync.
 */
const sourceArg = process.argv.find((argument) => argument.startsWith("--source="));
const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
const sourcePath = path.resolve(process.cwd(), sourceArg?.slice("--source=".length) || "data/arena.sqlite");
const outputPath = path.resolve(process.cwd(), outputArg?.slice("--output=".length) || "build-workers/videos.seed.sqlite");

const source = new DatabaseSync(sourcePath, { readOnly: true });
if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
const output = new DatabaseSync(outputPath);
output.exec(`
  CREATE TABLE videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER,
    url TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    catalog_position INTEGER NOT NULL DEFAULT 0,
    scraped_at TEXT NOT NULL
  );
  CREATE TABLE video_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    source TEXT NOT NULL,
    timestamp_seconds REAL,
    evidence_text TEXT NOT NULL,
    confidence REAL NOT NULL
  );
  CREATE TABLE video_champions (
    video_id TEXT NOT NULL,
    champion_key TEXT NOT NULL,
    source TEXT NOT NULL,
    evidence_text TEXT NOT NULL,
    confidence REAL NOT NULL,
    PRIMARY KEY(video_id, champion_key, source)
  );
  CREATE INDEX video_mentions_video_idx ON video_mentions(video_id);
  CREATE INDEX video_champions_video_idx ON video_champions(video_id);
`);

const videos = source.prepare("SELECT video_id, channel_id, title, description, published_at, duration_seconds, url, thumbnail_url, metadata_json, catalog_position, scraped_at FROM videos").all() as Array<{ video_id: string; channel_id: string; title: string; description: string; published_at: string; duration_seconds: number | null; url: string; thumbnail_url: string; metadata_json: string; catalog_position: number; scraped_at: string }>;
const mentions = source.prepare("SELECT video_id, entity_key, source, timestamp_seconds, evidence_text, confidence FROM video_mentions").all() as Array<{ video_id: string; entity_key: string; source: string; timestamp_seconds: number | null; evidence_text: string; confidence: number }>;
const champions = source.prepare(`
  SELECT vc.video_id, c.champion_key, vc.source, vc.evidence_text, vc.confidence
  FROM video_champions vc JOIN champions c ON c.id = vc.champion_id
`).all() as Array<{ video_id: string; champion_key: string; source: string; evidence_text: string; confidence: number }>;

output.exec("BEGIN");
try {
  const insertVideo = output.prepare(`
    INSERT INTO videos(video_id, channel_id, title, description, published_at, duration_seconds,
      url, thumbnail_url, metadata_json, catalog_position, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const video of videos) insertVideo.run(
    video.video_id, video.channel_id, video.title, video.description, video.published_at,
    video.duration_seconds, video.url, video.thumbnail_url, video.metadata_json,
    video.catalog_position, video.scraped_at,
  );
  const insertMention = output.prepare(`
    INSERT INTO video_mentions(video_id, entity_key, source, timestamp_seconds, evidence_text, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const mention of mentions) insertMention.run(
    mention.video_id, mention.entity_key, mention.source, mention.timestamp_seconds,
    mention.evidence_text, mention.confidence,
  );
  const insertChampion = output.prepare(`
    INSERT INTO video_champions(video_id, champion_key, source, evidence_text, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const champion of champions) insertChampion.run(
    champion.video_id, champion.champion_key, champion.source,
    champion.evidence_text, champion.confidence,
  );
  output.exec("COMMIT");
} catch (error) {
  output.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({
  source: sourcePath,
  output: outputPath,
  videos: videos.length,
  mentions: mentions.length,
  videoChampions: champions.length,
}, null, 2));
output.close();
source.close();
