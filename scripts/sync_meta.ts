import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../src/lib/schema";

const CHAMPION_SOURCE_URL = process.env.ARENA_CHAMPION_META_URL ?? "https://www.mobatrainer.com/lol/arena-tier-list";
const AUGMENT_SOURCE_URL = process.env.ARENA_AUGMENT_META_URL ?? "https://metabot.gg/en/league/arena/augments-tier-list";
const fetchedAt = new Date().toISOString();

type ChampionSourceRow = {
  championId: string;
  championName: string;
  tier: string;
  winRate: number;
  pickRate: number;
};

type SourceRecord = {
  entityKey: string;
  kind: "champion" | "augment";
  tier: string;
  winRate: number | null;
  pickRate: number | null;
  patch: string;
  sourceName: string;
  sourceUrl: string;
};

function normalized(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "ArenaBuildLab/0.5 (+local personal companion)", Accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}

function parseChampionSource(html: string): { patch: string; rows: ChampionSourceRow[] } {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Champion meta source did not include __NEXT_DATA__.");
  const payload = JSON.parse(match[1]) as { props?: { pageProps?: { meta?: { patch?: string }; rows?: ChampionSourceRow[] } } };
  const rows = payload.props?.pageProps?.rows ?? [];
  const patch = String(payload.props?.pageProps?.meta?.patch ?? "unknown");
  if (rows.length < 100) throw new Error(`Champion meta source returned only ${rows.length} rows.`);
  return { patch, rows };
}

function parseAugmentSource(html: string): { patch: string; rows: Array<{ name: string; tier: string; pickRate: number }> } {
  const patch = html.match(/League of Legends augments tier list[^<]{0,80}Patch\s+([\d.]+)/i)?.[1]
    ?? html.match(/Patch\s+([\d.]+)[^<]{0,80}augments tier list/i)?.[1]
    ?? "unknown";
  const rows = [...html.matchAll(/title="([^"]+?) - ([SABCDF]\+? Tier) \([^)]*\) and ([\d.]+)% pick rate"/g)].map((match) => ({
    name: decodeHtml(match[1]),
    tier: match[2].replace(" Tier", ""),
    pickRate: Number(match[3]),
  }));
  if (rows.length < 100) throw new Error(`Augment meta source returned only ${rows.length} rows.`);
  return { patch, rows };
}

async function main(): Promise<void> {
  const databasePath = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA_SQL);
  db.exec("PRAGMA busy_timeout = 10000");

  const [championHtml, augmentHtml] = await Promise.all([fetchHtml(CHAMPION_SOURCE_URL), fetchHtml(AUGMENT_SOURCE_URL)]);
  const championSource = parseChampionSource(championHtml);
  const augmentSource = parseAugmentSource(augmentHtml);

  const champions = db.prepare("SELECT champion_key, name FROM champions").all() as Array<{ champion_key: string; name: string }>;
  const augments = db.prepare("SELECT entity_key, name FROM entities WHERE kind='augment'").all() as Array<{ entity_key: string; name: string }>;
  const championByName = new Map(champions.flatMap((champion) => [[normalized(champion.name), champion], [normalized(champion.champion_key), champion]]));
  const augmentByName = new Map(augments.map((augment) => [normalized(augment.name), augment]));
  const records: SourceRecord[] = [];

  for (const row of championSource.rows) {
    const champion = championByName.get(normalized(row.championName)) ?? championByName.get(normalized(row.championId));
    if (!champion) continue;
    records.push({
      entityKey: `champion:${champion.champion_key}`,
      kind: "champion",
      tier: row.tier,
      winRate: Number(row.winRate),
      pickRate: Number(row.pickRate),
      patch: championSource.patch,
      sourceName: "MOBA Trainer",
      sourceUrl: CHAMPION_SOURCE_URL,
    });
  }

  for (const row of augmentSource.rows) {
    const augment = augmentByName.get(normalized(row.name));
    if (!augment) continue;
    records.push({
      entityKey: augment.entity_key,
      kind: "augment",
      tier: row.tier,
      winRate: null,
      pickRate: row.pickRate,
      patch: augmentSource.patch,
      sourceName: "MetaBot.GG",
      sourceUrl: AUGMENT_SOURCE_URL,
    });
  }

  const matchedChampions = records.filter((record) => record.kind === "champion").length;
  const matchedAugments = records.filter((record) => record.kind === "augment").length;
  if (matchedChampions < 100 || matchedAugments < 100) {
    throw new Error(`Refusing to replace meta data after only ${matchedChampions} champion and ${matchedAugments} augment matches.`);
  }

  const insert = db.prepare(`
  INSERT INTO arena_meta(entity_key, kind, tier, win_rate, pick_rate, patch, source_name, source_url, fetched_at, extra_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
  ON CONFLICT(entity_key) DO UPDATE SET
    kind=excluded.kind, tier=excluded.tier, win_rate=excluded.win_rate, pick_rate=excluded.pick_rate,
    patch=excluded.patch, source_name=excluded.source_name, source_url=excluded.source_url, fetched_at=excluded.fetched_at
`);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM arena_meta").run();
    for (const record of records) {
      insert.run(record.entityKey, record.kind, record.tier, record.winRate, record.pickRate, record.patch, record.sourceName, record.sourceUrl, fetchedAt);
    }
    db.prepare(`
      INSERT INTO metadata(key, value, updated_at) VALUES ('last_meta_sync', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(fetchedAt, fetchedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({
    databasePath,
    championSource: { url: CHAMPION_SOURCE_URL, patch: championSource.patch, parsed: championSource.rows.length, matched: matchedChampions },
    augmentSource: { url: AUGMENT_SOURCE_URL, patch: augmentSource.patch, parsed: augmentSource.rows.length, matched: matchedAugments, metric: "tier + pick rate (augment win rates intentionally not stored)" },
    fetchedAt,
  }, null, 2));
  db.close();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
