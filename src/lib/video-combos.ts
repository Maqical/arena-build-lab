import type { DatabaseSync } from "node:sqlite";

type VideoRow = {
  video_id: string;
  title: string;
  url: string;
};

type MentionRow = {
  entity_key: string;
  name: string;
  tags_json: string;
  produces_json: string;
  consumes_json: string;
};

type ChampionRow = {
  name: string;
  tags_json: string;
};

function stringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function displayTitle(title: string): string {
  return title
    .replace(/\s*\|\s*League(?: of Legends)? Arena Gameplay.*$/i, "")
    .replace(/\s*\|\s*Arena Gameplay.*$/i, "")
    .trim();
}

export function rebuildVideoCombos(db: DatabaseSync, patch: string): number {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='video_mentions'").get();
  if (!tables) return 0;

  const existingEvidence = new Set(
    (db.prepare("SELECT evidence_url FROM combos WHERE origin='curated' AND evidence_url <> ''").all() as Array<{ evidence_url: string }>)
      .map((row) => row.evidence_url),
  );
  const candidates = db.prepare(`
    SELECT v.video_id, v.title, v.url
    FROM videos v
    JOIN video_mentions vm ON vm.video_id = v.video_id AND vm.source = 'title'
    WHERE lower(v.title) LIKE '%arena%'
    GROUP BY v.video_id, v.title, v.url
    HAVING COUNT(DISTINCT vm.entity_key) >= 2
    ORDER BY v.catalog_position ASC
  `).all() as VideoRow[];

  const mentionQuery = db.prepare(`
    SELECT DISTINCT e.entity_key, e.name, e.tags_json, e.produces_json, e.consumes_json
    FROM video_mentions vm
    JOIN entities e ON e.entity_key = vm.entity_key
    WHERE vm.video_id = ? AND vm.source = 'title'
    ORDER BY instr(lower(?), lower(e.name)), e.name
  `);
  const championQuery = db.prepare(`
    SELECT DISTINCT c.name, c.tags_json
    FROM video_champions vc
    JOIN champions c ON c.id = vc.champion_id
    WHERE vc.video_id = ? AND vc.source = 'title'
  `);
  const insert = db.prepare(`
    INSERT INTO combos(
      slug, title, summary, entity_keys_json, champion_tags_json, goal_tags_json,
      score, evidence_url, evidence_note, patch, generated, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'video')
  `);

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM combos WHERE origin='video'");
    let count = 0;
    for (const video of candidates) {
      if (existingEvidence.has(video.url)) continue;
      const mentions = mentionQuery.all(video.video_id, video.title) as MentionRow[];
      if (mentions.length < 2) continue;

      const champions = championQuery.all(video.video_id) as ChampionRow[];
      const championTags = [...new Set(champions.flatMap((champion) => [champion.name, ...stringArray(champion.tags_json)]))];
      const goals = [...new Set(mentions.flatMap((mention) => [
        ...stringArray(mention.tags_json),
        ...stringArray(mention.produces_json),
        ...stringArray(mention.consumes_json),
      ]))];
      const names = mentions.map((mention) => mention.name);
      const score = Math.min(94, 76 + names.length * 5 + (champions.length > 0 ? 3 : 0));
      insert.run(
        `video-${video.video_id}`,
        displayTitle(video.title),
        `${names.join(" + ")} were matched as exact title-level Arena evidence. Use the linked video and caption timestamps to inspect acquisition order, rolls, and the patch-specific outcome.`,
        JSON.stringify(mentions.map((mention) => mention.entity_key)),
        JSON.stringify(championTags),
        JSON.stringify(goals),
        score,
        video.url,
        "Video title evidence matched against the current Arena entity catalog. Historical videos may use older balance values.",
        patch,
      );
      count += 1;
    }
    db.exec("COMMIT");
    return count;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
