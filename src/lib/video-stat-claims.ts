import type { DatabaseSync } from "node:sqlite";

export type VideoStatClaim = {
  video_id: string;
  champion_key: string;
  stat_key: string;
  stat_label: string;
  value: number;
  unit: string;
  evidence_text: string;
  source: string;
  confidence: number;
};

const SCALE = new Map<string, number>([
  ["k", 1_000],
  ["m", 1_000_000],
]);

const STAT_LEXICON: Array<{ key: string; label: string; patterns: RegExp[]; unit: string }> = [
  { key: "lethality", label: "Lethality", patterns: [/\b(\d+(?:\.\d+)?)\s*(lethality)\b/i], unit: "" },
  { key: "maxHealth", label: "Max HP", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(max\s+)?(hp|health)\b/i], unit: "" },
  { key: "totalAttackDamage", label: "Attack damage", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(max\s+)?(ad|attack damage)\b/i], unit: "" },
  { key: "abilityPower", label: "Ability power", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(max\s+)?(ap|ability power)\b/i], unit: "" },
  { key: "attackSpeed", label: "Attack speed", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(max\s+)?(as|attack speed)\b/i], unit: "" },
  { key: "armor", label: "Armor", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(armor|armour)\b/i], unit: "" },
  { key: "magicResistance", label: "Magic resist", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(mr|magic resist(?:ance)?)\b/i], unit: "" },
  { key: "moveSpeed", label: "Move speed", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(move speed|movement speed|ms)\b/i], unit: "" },
  { key: "abilityHaste", label: "Ability haste", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(ability haste|cdr|cooldown reduction)\b/i], unit: "" },
  { key: "critChancePercent", label: "Crit chance", patterns: [/\b(\d+(?:\.\d+)?)\s*(%|percent)\s*(crit(?: chance)?)\b/i, /\b(\d+(?:\.\d+)?)\s*(crit chance)\b/i], unit: "%" },
  { key: "critDamagePercent", label: "Crit damage", patterns: [/\b(\d+(?:\.\d+)?)\s*(%|percent)\s*(crit damage)\b/i], unit: "%" },
  { key: "stacks", label: "Stacks", patterns: [/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(stacks?|souls?)\b/i], unit: "" },
  { key: "ccDuration", label: "CC duration", patterns: [/\b(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(second|sec(?:ond)?s?)\s*(stun|root|snare|cc|silence|slow|knockup|suppression)\b/i], unit: "s" },
];

function multiplierFrom(match: string | undefined): number {
  return match ? (SCALE.get(match.toLowerCase()) ?? 1) : 1;
}

/**
 * Extract quantified stat claims from video titles (and description-sourced
 * champion evidence). Purely lexical: every claim carries its raw evidence
 * text so a human can audit the extraction against the actual video title.
 */
export function extractVideoStatClaims(db: DatabaseSync): { inserted: number; deleted: number } {
  const videos = db.prepare(`
    SELECT v.video_id, v.title, v.description
    FROM videos v
    ORDER BY v.catalog_position ASC, v.published_at DESC
  `).all() as Array<{ video_id: string; title: string; description: string }>;

  const champions = db.prepare("SELECT champion_key, name FROM champions").all() as Array<{ champion_key: string; name: string }>;
  const entities = db.prepare("SELECT entity_key, name FROM entities").all() as Array<{ entity_key: string; name: string }>;
  const videoChampions = db.prepare(`
    SELECT vc.video_id, c.champion_key
    FROM video_champions vc JOIN champions c ON c.id = vc.champion_id
    WHERE vc.source = 'title'
  `).all() as Array<{ video_id: string; champion_key: string }>;

  const championByVideo = new Map(videoChampions.map((row) => [row.video_id, row.champion_key]));
  const championByTitle = new Map<string, string>();
  const championNamePatterns: Array<{ key: string; pattern: RegExp }> = [];
  for (const champion of champions) {
    const escaped = champion.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    championNamePatterns.push({ key: champion.champion_key, pattern: new RegExp(`\\b${escaped}\\b`, "i") });
    if (!championByTitle.has(champion.name.toLowerCase())) championByTitle.set(champion.name.toLowerCase(), champion.champion_key);
  }
  const entityPatterns: Array<{ key: string; name: string; pattern: RegExp }> = entities.map((entity) => ({
    key: entity.entity_key,
    name: entity.name,
    pattern: new RegExp(`\\b(${entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i"),
  }));

  const seen = new Set<string>();
  const claims: VideoStatClaim[] = [];
  for (const video of videos) {
    const title = video.title;
    let championKey = championByVideo.get(video.video_id) ?? "";
    for (const candidate of championNamePatterns) {
      if (candidate.pattern.test(title)) {
        championKey = candidate.key;
        break;
      }
    }

    for (const stat of STAT_LEXICON) {
      for (const pattern of stat.patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(title);
        if (!match) continue;
        const value = Number(match[1]) * multiplierFrom(match[2]);
        if (!Number.isFinite(value) || value <= 0) continue;
        const evidence = title.trim().slice(Math.max(0, match.index - 18), Math.min(title.length, match.index + match[0].length + 18));
        const key = `${video.video_id}:${championKey}:${stat.key}:${value}:${stat.unit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push({
          video_id: video.video_id,
          champion_key: championKey,
          stat_key: stat.key,
          stat_label: stat.label,
          value,
          unit: stat.unit,
          evidence_text: evidence,
          source: "title",
          confidence: championKey ? 0.95 : 0.8,
        });
      }
    }

    // "257% Shardblade" style claims: a percentage immediately before a known
    // catalog entity name (e.g. an item roll or an augment).
    const percentPattern = /\b(\d+(?:\.\d+)?)\s*(%|percent)\s+([A-Za-z][A-Za-z0-9' .-]{2,40})\b/gi;
    percentPattern.lastIndex = 0;
    let percentMatch = percentPattern.exec(title);
    while (percentMatch) {
      const value = Number(percentMatch[1]);
      const candidateText = percentMatch[3];
      const entity = entityPatterns.find((candidate) => candidate.pattern.test(candidateText));
      if (Number.isFinite(value) && value > 0 && entity) {
        const key = `${video.video_id}:${championKey}:${entity.key}:${value}:%`;
        if (!seen.has(key)) {
          seen.add(key);
          claims.push({
            video_id: video.video_id,
            champion_key: championKey,
            stat_key: entity.key,
            stat_label: entity.name,
            value,
            unit: "%",
            evidence_text: title.trim().slice(Math.max(0, percentMatch.index - 18), Math.min(title.length, percentMatch.index + percentMatch[0].length + 18)),
            source: "title",
            confidence: championKey ? 0.9 : 0.75,
          });
        }
      }
      percentMatch = percentPattern.exec(title);
    }
  }

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const deleted = Number(db.prepare("DELETE FROM video_stat_claims WHERE source = 'title'").run().changes ?? 0);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO video_stat_claims(
        video_id, champion_key, stat_key, stat_label, value, unit,
        evidence_text, source, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    for (const claim of claims) inserted += Number(insert.run(claim.video_id, claim.champion_key, claim.stat_key, claim.stat_label, claim.value, claim.unit, claim.evidence_text, claim.source, claim.confidence, now).changes ?? 0);
    db.exec("COMMIT");
    return { inserted, deleted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
