import "server-only";

import { getDatabase } from "@/lib/db";
import { getExtremeBuildCsvRows } from "@/lib/extreme-build-csv";
import type { ChampSelectEntityRecommendation, ChampSelectRecommendation, DuoRecommendation } from "@/lib/champ-select-types";
import { getDuoSynergies } from "@/lib/duo-synergy";
import { championMatchups } from "@/lib/competitive-insights";

type Row = Record<string, unknown>;
type CandidateScore = { score: number; reasons: Set<string> };

function normalized(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function tierWeight(tier: string): number {
  return ({ "S+": 6, S: 5, A: 4, B: 3, C: 2, D: 1 } as Record<string, number>)[tier.toUpperCase()] ?? 0;
}

function addCandidate(scores: Map<string, CandidateScore>, key: string, score: number, reason: string): void {
  const candidate = scores.get(key) ?? { score: 0, reasons: new Set<string>() };
  candidate.score += score;
  candidate.reasons.add(reason);
  scores.set(key, candidate);
}

function desiredPartnerTags(tags: readonly string[]): string[] {
  const desired = new Set<string>();
  if (tags.some((tag) => ["Marksman", "Mage", "Assassin"].includes(tag))) ["Tank", "Support", "Fighter"].forEach((tag) => desired.add(tag));
  if (tags.some((tag) => ["Tank", "Support"].includes(tag))) ["Marksman", "Mage", "Fighter"].forEach((tag) => desired.add(tag));
  if (tags.includes("Fighter")) ["Support", "Mage", "Marksman"].forEach((tag) => desired.add(tag));
  if (desired.size === 0) ["Tank", "Support", "Marksman"].forEach((tag) => desired.add(tag));
  return [...desired];
}

export function getChampSelectRecommendation(championReference: string | number): ChampSelectRecommendation | null {
  const db = getDatabase();
  const reference = String(championReference).trim();
  const champion = db.prepare(`
    SELECT * FROM champions
    WHERE CAST(id AS TEXT)=? OR lower(champion_key)=lower(?) OR lower(name)=lower(?)
    LIMIT 1
  `).get(reference, reference, reference) as Row | undefined;
  if (!champion) return null;

  const championId = Number(champion.id);
  const championKey = String(champion.champion_key);
  const championName = String(champion.name);
  const championTags = jsonArray(champion.tags_json);
  const championMeta = db.prepare("SELECT * FROM arena_meta WHERE entity_key=?").get(`champion:${championKey}`) as Row | undefined;
  const extremeBuilds = getExtremeBuildCsvRows()
    .filter((build) => normalized(build.champion) === normalized(championName))
    .sort((left, right) => right.benchmarkScore - left.benchmarkScore || left.rank - right.rank);

  const entityRows = db.prepare("SELECT entity_key,name,kind,rarity,description,icon_url FROM entities").all() as Row[];
  const entityByKey = new Map(entityRows.map((entity) => [String(entity.entity_key), entity]));
  const entityByName = new Map(entityRows.map((entity) => [normalized(String(entity.name)), entity]));
  const augmentScores = new Map<string, CandidateScore>();
  const itemScores = new Map<string, CandidateScore>();

  for (const build of extremeBuilds) {
    for (const augment of build.augments) {
      const entity = entityByName.get(normalized(augment));
      if (entity?.kind === "augment") addCandidate(augmentScores, String(entity.entity_key), 220 - build.rank * 4, `${build.champion}'s #${build.rank} ${build.objective} benchmark`);
    }
    for (const item of build.fixedItems) {
      const entity = entityByName.get(normalized(item));
      if (entity?.kind === "item") addCandidate(itemScores, String(entity.entity_key), 230 - build.rank * 4, `${build.champion}'s ${build.objective} conversion anchor`);
    }
  }

  const combos = db.prepare("SELECT title,score,champion_tags_json,entity_keys_json FROM combos WHERE origin='curated' ORDER BY score DESC").all() as Row[];
  for (const combo of combos) {
    const tags = jsonArray(combo.champion_tags_json);
    const exact = tags.some((tag) => normalized(tag) === normalized(championName) || normalized(tag) === normalized(championKey));
    const sharedRoles = tags.filter((tag) => championTags.includes(tag));
    if (!exact && sharedRoles.length === 0) continue;
    const relevance = exact ? 1.8 : Math.min(1.15, 0.55 + sharedRoles.length * 0.3);
    for (const key of jsonArray(combo.entity_keys_json)) {
      const entity = entityByKey.get(key);
      if (!entity) continue;
      const destination = entity.kind === "augment" ? augmentScores : itemScores;
      addCandidate(destination, key, Number(combo.score) * relevance, exact ? `Curated ${championName} path: ${combo.title}` : `${sharedRoles.join("/")} conversion path: ${combo.title}`);
    }
  }

  const augmentMetaRows = db.prepare("SELECT entity_key,tier,pick_rate FROM arena_meta WHERE kind='augment'").all() as Row[];
  const augmentMeta = new Map(augmentMetaRows.map((row) => [String(row.entity_key), row]));
  for (const row of augmentMetaRows) {
    const key = String(row.entity_key);
    if (!augmentScores.has(key)) addCandidate(augmentScores, key, tierWeight(String(row.tier)) * 5 + Number(row.pick_rate ?? 0) * 0.2, "Current Arena tier/pick fallback");
  }

  const mapEntity = ([key, candidate]: [string, CandidateScore]): ChampSelectEntityRecommendation | null => {
    const entity = entityByKey.get(key);
    if (!entity) return null;
    const meta = augmentMeta.get(key);
    return {
      entityKey: key,
      name: String(entity.name),
      kind: String(entity.kind) as "augment" | "item",
      rarity: String(entity.rarity),
      description: String(entity.description ?? ""),
      iconUrl: String(entity.icon_url ?? ""),
      tier: String(meta?.tier ?? ""),
      pickRate: meta?.pick_rate == null ? null : Number(meta.pick_rate),
      reason: [...candidate.reasons][0] ?? "Local build-graph match",
    };
  };
  const ranked = (scores: Map<string, CandidateScore>, limit: number) => [...scores.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .map(mapEntity)
    .filter((entity): entity is ChampSelectEntityRecommendation => Boolean(entity))
    .slice(0, limit);

  const desiredTags = desiredPartnerTags(championTags);
  const duoRows = db.prepare(`
    SELECT c.id,c.champion_key,c.name,c.icon_url,c.tags_json,m.tier,m.win_rate,m.pick_rate
    FROM champions c LEFT JOIN arena_meta m ON m.entity_key='champion:'||c.champion_key
    WHERE c.id<>?
  `).all(championId) as Row[];
  const calculatedSynergies = new Map(getDuoSynergies(championId).map((entry) => [entry.championId, entry]));
  const duoRecommendations: DuoRecommendation[] = duoRows.map((row) => {
    const tags = jsonArray(row.tags_json);
    const fitTags = tags.filter((tag) => desiredTags.includes(tag));
    const synergy = calculatedSynergies.get(Number(row.id));
    const score = (synergy ? 1000 + synergy.synergyScore * 100 : 0) + fitTags.length * 9 + Number(row.win_rate ?? 0) + tierWeight(String(row.tier ?? "")) * 1.5;
    return {
      score,
      recommendation: {
        championId: Number(row.id), championKey: String(row.champion_key), name: String(row.name), iconUrl: String(row.icon_url), tags,
        tier: String(row.tier ?? ""), winRate: synergy ? synergy.firstPlaceRate * 100 : row.win_rate == null ? null : Number(row.win_rate), pickRate: row.pick_rate == null ? null : Number(row.pick_rate), fitTags,
        synergyScore: synergy?.synergyScore, gamesTogether: synergy?.gamesTogether,
      },
    };
  }).filter((entry) => entry.recommendation.fitTags.length > 0 || (entry.recommendation.gamesTogether ?? 0) > 0).sort((left, right) => right.score - left.score).slice(0, 4).map((entry) => entry.recommendation);
  const matchupRows = championMatchups(championId, "global", 80);
  const mappedMatchup = (row: (typeof matchupRows)[number]) => ({ championId: row.championId, name: row.name, iconUrl: row.iconUrl, games: row.games, aheadRate: row.aheadRate });
  const favorableMatchups = [...matchupRows].sort((left, right) => right.aheadRate - left.aheadRate).slice(0, 3).map(mappedMatchup);
  const difficultMatchups = [...matchupRows].sort((left, right) => left.aheadRate - right.aheadRate).slice(0, 3).map(mappedMatchup);

  return {
    champion: { id: championId, key: championKey, name: championName, iconUrl: String(champion.icon_url), tags: championTags },
    meta: championMeta ? {
      tier: String(championMeta.tier), winRate: championMeta.win_rate == null ? null : Number(championMeta.win_rate),
      pickRate: championMeta.pick_rate == null ? null : Number(championMeta.pick_rate), patch: String(championMeta.patch),
    } : null,
    duoRecommendations,
    favorableMatchups,
    difficultMatchups,
    recommendedAugments: ranked(augmentScores, 5),
    recommendedItems: ranked(itemScores, 3),
    extremeBuilds: extremeBuilds.slice(0, 4),
    note: "Duo and matchup guidance is calculated from source-labelled local match outcomes. Build recommendations use local extreme benchmarks and curated conversion paths.",
  };
}
