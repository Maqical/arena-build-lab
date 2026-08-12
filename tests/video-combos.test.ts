import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";
import { rebuildVideoCombos } from "../src/lib/video-combos";

test("turns an exact multi-entity Arena title into a video-backed combo", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  const insertEntity = db.prepare(`
    INSERT INTO entities(
      entity_key, kind, numeric_id, api_name, name, rarity, description, tooltip,
      icon_url, purchasable, price, tags_json, produces_json, consumes_json,
      raw_json, patch, source_url
    ) VALUES (?, 'augment', ?, '', ?, 'gold', '', '', '', 1, 0, ?, ?, ?, '{}', 'test', '')
  `);
  insertEntity.run("augment:1", 1, "Tank Engine", '["health","stacking"]', '["health"]', '[]');
  insertEntity.run("augment:2", 2, "Steel Your Heart", '["health","stacking"]', '["health"]', '[]');
  db.prepare(`
    INSERT INTO videos(video_id, channel_id, title, url, scraped_at)
    VALUES ('abc', 'channel', 'Steel Your Heart + Tank Engine Sion | League Arena Gameplay', 'https://youtu.be/abc', 'now')
  `).run();
  db.prepare(`
    INSERT INTO video_mentions(video_id, entity_key, source, evidence_text, confidence)
    VALUES ('abc', ?, 'title', 'title', .98)
  `).run("augment:1");
  db.prepare(`
    INSERT INTO video_mentions(video_id, entity_key, source, evidence_text, confidence)
    VALUES ('abc', ?, 'title', 'title', .98)
  `).run("augment:2");

  assert.equal(rebuildVideoCombos(db, "test"), 1);
  const combo = db.prepare("SELECT title, origin, generated, evidence_url FROM combos").get() as Record<string, unknown>;
  assert.equal(combo.title, "Steel Your Heart + Tank Engine Sion");
  assert.equal(combo.origin, "video");
  assert.equal(combo.generated, 0);
  assert.equal(combo.evidence_url, "https://youtu.be/abc");
  db.close();
});
