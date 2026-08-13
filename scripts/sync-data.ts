import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { analyzeMechanics, slugify, stripMarkup } from "../src/lib/mechanics";
import { SCHEMA_SQL } from "../src/lib/schema";
import { rebuildVideoCombos } from "../src/lib/video-combos";

const ARENA_SOURCE = "https://raw.communitydragon.org/latest/cdragon/arena/en_us.json";
const ITEMS_SOURCE = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";
const VERSIONS_SOURCE = "https://ddragon.leagueoflegends.com/api/versions.json";

type JsonRecord = Record<string, unknown>;

type ImportedEntity = {
  entityKey: string;
  kind: "augment" | "item";
  numericId: number;
  apiName: string;
  name: string;
  rarity: string;
  description: string;
  tooltip: string;
  iconUrl: string;
  purchasable: boolean;
  price: number;
  tags: string[];
  produces: string[];
  consumes: string[];
  raw: unknown;
  patch: string;
  sourceUrl: string;
};

type CuratedCombo = {
  slug: string;
  title: string;
  summary: string;
  entities: Array<{ kind: "augment" | "item"; name: string }>;
  championTags: string[];
  goals: string[];
  score: number;
  evidenceUrl?: string;
  evidenceNote?: string;
};

const CURATED_COMBOS: CuratedCombo[] = [
  {
    slug: "sion-heartstack-foundry",
    title: "660k HP Sion Heartstack Foundry",
    summary: "Take Heartsteel on round two, complete Quest: Steel Your Heart, and level Tank Engine so each takedown multiplies the enlarged bonus-health pool. Overlord's Bloodmail then converts that bonus health into AD. In the recorded run, the tracker reported roughly 144k health from the quest and 212k from Tank Engine near the finish.",
    entities: [
      { kind: "augment", name: "Quest: Steel Your Heart" },
      { kind: "augment", name: "Tank Engine" },
      { kind: "item", name: "Heartsteel" },
      { kind: "item", name: "Overlord's Bloodmail" },
    ],
    championTags: ["Tank", "Fighter", "Sion"],
    goals: ["health", "attack_damage", "on_hit", "stacking"],
    score: 99,
    evidenceUrl: "https://www.youtube.com/watch?v=A9DAzOXMdqo",
    evidenceNote: "Video evidence: 660k Max HP Sion. Title evidence for Steel Your Heart + Tank Engine; captions confirm round-two Heartsteel, Overlord's, and the late-run tracker values.",
  },
  {
    slug: "mana-to-meat",
    title: "Mana-to-Meat Conversion",
    summary: "Build mana, convert it into maximum health, then branch that health into bonus AD and health-scaled attacks.",
    entities: [
      { kind: "augment", name: "Mind to Matter" },
      { kind: "item", name: "Overlord's Bloodmail" },
      { kind: "augment", name: "Heavy Hitter" },
    ],
    championTags: ["Tank", "Mage"],
    goals: ["mana", "health", "attack_damage", "on_hit", "conversion"],
    score: 96,
  },
  {
    slug: "ap-haste-speed-feedback",
    title: "AP → Haste → Speed Feedback",
    summary: "Ability Power becomes haste, haste becomes move speed, and Tap Dancer turns movement into attack speed while attacks keep its movement stacks rolling.",
    entities: [
      { kind: "augment", name: "Eureka" },
      { kind: "augment", name: "With Haste" },
      { kind: "augment", name: "Tap Dancer" },
    ],
    championTags: ["Mage", "Marksman"],
    goals: ["ability_power", "ability_haste", "movement_speed", "attack_speed", "conversion"],
    score: 98,
  },
  {
    slug: "blossoming-death-loop",
    title: "Blossoming Death Engine",
    summary: "Heal and shield power grants attack speed through Sword of Blossoming Dawn; faster attacks produce more healing, which Circle of Death converts into damage.",
    entities: [
      { kind: "item", name: "Sword of Blossoming Dawn" },
      { kind: "augment", name: "Circle of Death" },
      { kind: "augment", name: "Quest: Angel of Retribution" },
    ],
    championTags: ["Support", "Marksman"],
    goals: ["heal_shield", "attack_speed", "on_hit", "conversion"],
    score: 99,
    evidenceUrl: "https://www.youtube.com/watch?v=-UVNNepMryE",
    evidenceNote: "Video evidence: Upgrade Sword of Blossoming + Circle of Death.",
  },
  {
    slug: "adapt-marksman-mage",
    title: "ADAPt Marksman-Mage",
    summary: "Convert bonus AD into amplified AP, make that AP power attacks through Marksmage, and turn it into ability haste with Eureka.",
    entities: [
      { kind: "augment", name: "ADAPt" },
      { kind: "augment", name: "Marksmage" },
      { kind: "augment", name: "Eureka" },
    ],
    championTags: ["Marksman", "Mage"],
    goals: ["attack_damage", "ability_power", "on_hit", "ability_haste", "conversion"],
    score: 95,
  },
  {
    slug: "crit-overflow-payload",
    title: "Crit Overflow Payload",
    summary: "Aim for the Head converts excess critical chance into critical damage; pair it with effects that allow abilities or persistent damage to use the enlarged crit multiplier.",
    entities: [
      { kind: "augment", name: "Aim for the Head" },
      { kind: "augment", name: "Jeweled Gauntlet" },
      { kind: "augment", name: "Vulnerability" },
    ],
    championTags: ["Mage", "Assassin", "Marksman"],
    goals: ["crit_chance", "crit_damage", "burn", "damage_amp"],
    score: 94,
  },
  {
    slug: "curse-titan",
    title: "Cursed Titan",
    summary: "Use a repeatable Cursed Power generator, then cash the shared stack pool into maximum health and adaptive force. The model keeps combat duration explicit because the ceiling depends on uptime.",
    entities: [
      { kind: "augment", name: "Dreadbringer" },
      { kind: "augment", name: "Doomsayer" },
      { kind: "augment", name: "Deathtouch" },
    ],
    championTags: ["Tank", "Fighter", "Mage"],
    goals: ["cursed_power", "health", "attack_damage", "ability_power", "stacking"],
    score: 93,
  },
  {
    slug: "ap-escape-physical",
    title: "AP Escape Route",
    summary: "Stack AP efficiently, convert it to bonus attack damage with escAPADe, and amplify the physical result through missing-health and bonus-health scaling.",
    entities: [
      { kind: "augment", name: "escAPADe" },
      { kind: "item", name: "Overlord's Bloodmail" },
    ],
    championTags: ["Fighter", "Mage"],
    goals: ["ability_power", "attack_damage", "conversion"],
    score: 87,
  },
  {
    slug: "speed-limit-breaker",
    title: "Attack-Speed Limit Breaker",
    summary: "Tap Dancer supplies movement-driven attack speed and Lightning Strikes raises the useful ceiling while adding an on-hit payoff past the breakpoint.",
    entities: [
      { kind: "augment", name: "Tap Dancer" },
      { kind: "augment", name: "Lightning Strikes" },
    ],
    championTags: ["Marksman", "Fighter"],
    goals: ["attack_speed", "movement_speed", "on_hit"],
    score: 91,
  },
  {
    slug: "mana-singularity",
    title: "Mana Singularity",
    summary: "Max mana simultaneously feeds Archangel's AP, Fimbulwinter and Mind to Matter health, and Overflow's ability amplification. Overlord's Bloodmail turns the enlarged health branch into attack damage, allowing one resource stack to fund several outputs.",
    entities: [
      { kind: "augment", name: "Mind to Matter" },
      { kind: "augment", name: "Overflow" },
      { kind: "item", name: "Archangel's Staff" },
      { kind: "item", name: "Fimbulwinter" },
      { kind: "item", name: "Overlord's Bloodmail" },
    ],
    championTags: ["Tank", "Mage"],
    goals: ["mana", "health", "ability_power", "attack_damage", "conversion"],
    score: 97,
  },
  {
    slug: "health-crit-overflow",
    title: "Health → Crit → Crit Damage Overflow",
    summary: "Heartsteel quest and Tank Engine grow bonus health; Atma's Reckoning converts that pool into critical chance, and Aim for the Head converts chance beyond its cap into critical damage. This is a three-stage scaling chain from health stacking into burst.",
    entities: [
      { kind: "augment", name: "Quest: Steel Your Heart" },
      { kind: "augment", name: "Tank Engine" },
      { kind: "item", name: "Atma's Reckoning" },
      { kind: "augment", name: "Aim for the Head" },
    ],
    championTags: ["Tank", "Fighter", "Sion"],
    goals: ["health", "crit_chance", "crit_damage", "stacking", "conversion"],
    score: 98,
  },
  {
    slug: "missing-health-feedback",
    title: "Missing-Health Speed Cascade",
    summary: "Demonic Embrace turns missing health into AP and move speed. Eureka converts the AP to ability haste, With Haste converts haste to more move speed, and Tap Dancer converts movement into attack speed.",
    entities: [
      { kind: "item", name: "Demonic Embrace" },
      { kind: "augment", name: "Eureka" },
      { kind: "augment", name: "With Haste" },
      { kind: "augment", name: "Tap Dancer" },
    ],
    championTags: ["Mage", "Fighter", "Marksman"],
    goals: ["health", "ability_power", "ability_haste", "movement_speed", "attack_speed", "conversion"],
    score: 96,
  },
  {
    slug: "ap-ad-haste-bridge",
    title: "AP → AD → Haste Bridge",
    summary: "Wooglet's Witchcap supplies the oversized AP pool, escAPADe converts it into bonus AD, and Endless Hunger converts bonus AD into ability haste. It lets an AP stacking plan cross into physical scaling and cooldown compression.",
    entities: [
      { kind: "augment", name: "Quest: Wooglet's Witchcap" },
      { kind: "augment", name: "escAPADe" },
      { kind: "item", name: "Endless Hunger" },
    ],
    championTags: ["Mage", "Fighter", "Assassin"],
    goals: ["ability_power", "attack_damage", "ability_haste", "conversion", "quest"],
    score: 95,
  },
  {
    slug: "all-stat-compounding",
    title: "All-Stat Compounding Core",
    summary: "Demon King's Crown scales its six combat stats with round wins while Dragonheart multiplies seven combat stats per soul. Stats on Stats! adds another broad stat package, making percentage multipliers unusually efficient when the lobby lets the core mature.",
    entities: [
      { kind: "item", name: "Demon King's Crown" },
      { kind: "item", name: "Dragonheart" },
      { kind: "augment", name: "Stats on Stats!" },
    ],
    championTags: ["Tank", "Fighter", "Mage", "Marksman", "Assassin"],
    goals: ["health", "ability_power", "attack_damage", "attack_speed", "ability_haste", "stacking"],
    score: 94,
  },
];

const EDGE_DEFINITIONS = [
  ["augment", "Mind to Matter", "mana", "health", "gain_based_on", "ManaToHealthCalc"],
  ["augment", "ADAPt", "attack_damage", "ability_power", "convert", "ConversionRate"],
  ["augment", "escAPADe", "ability_power", "attack_damage", "convert", "ConversionRate"],
  ["augment", "Eureka", "ability_power", "ability_haste", "gain_based_on", "APToHasteConversion"],
  ["augment", "With Haste", "ability_haste", "movement_speed", "gain_based_on", "AbilityHasteToMS"],
  ["augment", "Tap Dancer", "movement_speed", "attack_speed", "gain_based_on", "MSToASConversion"],
  ["augment", "Heavy Hitter", "health", "attack_damage", "on_hit_damage", "MaxHPRatio"],
  ["augment", "Circle of Death", "heal_shield", "magic_damage", "convert", "HealToDamageConversion"],
  ["augment", "Dreadbringer", "cursed_power", "health", "gain_based_on", "MaxHealthRatio"],
  ["augment", "Aim for the Head", "crit_chance", "crit_damage", "overflow_convert", "CritChanceToDamageRatio"],
  ["item", "Overlord's Bloodmail", "health", "attack_damage", "gain_based_on", "3% Bonus HP"],
  ["item", "Sword of Blossoming Dawn", "heal_shield", "attack_speed", "gain_based_on", "Effervescence"],
  ["item", "Atma's Reckoning", "health", "crit_chance", "gain_based_on", "Big Hands"],
  ["item", "Demonic Embrace", "missing_health", "ability_power", "gain_based_on", "Sinister Pact"],
  ["item", "Endless Hunger", "attack_damage", "ability_haste", "gain_based_on", "Famine"],
  ["augment", "Overflow", "mana", "ability_power", "amplify_based_on", "ManaRatio"],
  ["item", "Dragonheart", "dragon_soul", "all_stats", "multiply", "Inner Flame"],
] as const;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "ArenaBuildLab/0.1" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function cdragonAsset(pathname: string): string {
  const cleaned = pathname.replace(/^\/lol-game-data\/assets\//i, "").replace(/^\//, "").toLowerCase();
  return `https://raw.communitydragon.org/latest/game/${cleaned}`;
}

function openDatabase(): DatabaseSync {
  const filename = path.resolve(process.cwd(), process.env.ARENA_DB_PATH ?? "data/arena.sqlite");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA_SQL);
  db.exec("PRAGMA busy_timeout = 10000");
  const comboColumns = db.prepare("PRAGMA table_info(combos)").all() as Array<{ name: string }>;
  if (!comboColumns.some((column) => column.name === "origin")) {
    db.exec("ALTER TABLE combos ADD COLUMN origin TEXT NOT NULL DEFAULT 'curated'");
    db.exec("UPDATE combos SET origin = CASE WHEN generated = 1 THEN 'generated' ELSE 'curated' END");
  }
  return db;
}

function metadata(db: DatabaseSync, key: string, value: string): void {
  db.prepare(`
    INSERT INTO metadata(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

function upsertEntities(db: DatabaseSync, entities: ImportedEntity[]): void {
  const statement = db.prepare(`
    INSERT INTO entities(
      entity_key, kind, numeric_id, api_name, name, rarity, description, tooltip,
      icon_url, purchasable, price, tags_json, produces_json, consumes_json,
      raw_json, patch, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_key) DO UPDATE SET
      api_name=excluded.api_name, name=excluded.name, rarity=excluded.rarity,
      description=excluded.description, tooltip=excluded.tooltip, icon_url=excluded.icon_url,
      purchasable=excluded.purchasable, price=excluded.price, tags_json=excluded.tags_json,
      produces_json=excluded.produces_json, consumes_json=excluded.consumes_json,
      raw_json=excluded.raw_json, patch=excluded.patch, source_url=excluded.source_url
  `);

  db.exec("BEGIN");
  try {
    for (const entity of entities) {
      statement.run(
        entity.entityKey,
        entity.kind,
        entity.numericId,
        entity.apiName,
        entity.name,
        entity.rarity,
        entity.description,
        entity.tooltip,
        entity.iconUrl,
        entity.purchasable ? 1 : 0,
        entity.price,
        JSON.stringify(entity.tags),
        JSON.stringify(entity.produces),
        JSON.stringify(entity.consumes),
        JSON.stringify(entity.raw),
        entity.patch,
        entity.sourceUrl,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function entityKeyByName(db: DatabaseSync, kind: string, name: string): string | null {
  const row = db.prepare(`
    SELECT entity_key FROM entities
    WHERE kind = ? AND lower(name) = lower(?)
    ORDER BY purchasable DESC, price DESC, numeric_id DESC
    LIMIT 1
  `).get(kind, name) as { entity_key?: string } | undefined;
  return row?.entity_key ?? null;
}

function rebuildEdges(db: DatabaseSync, patch: string): void {
  db.exec("DELETE FROM mechanic_edges");
  const selectRaw = db.prepare("SELECT raw_json, source_url FROM entities WHERE entity_key = ?");
  const insert = db.prepare(`
    INSERT INTO mechanic_edges(entity_key, source_stat, target_stat, operation, coefficient_json, conditions, confidence, patch, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [kind, name, source, target, operation, coefficientName] of EDGE_DEFINITIONS) {
    const entityKey = entityKeyByName(db, kind, name);
    if (!entityKey) continue;
    const row = selectRaw.get(entityKey) as { raw_json: string; source_url: string };
    const raw = JSON.parse(row.raw_json) as JsonRecord;
    const dataValues = record(raw.dataValues);
    const coefficient = dataValues[coefficientName] ?? coefficientName;
    insert.run(
      entityKey,
      source,
      target,
      operation,
      JSON.stringify(coefficient),
      stripMarkup(text(raw.tooltip) || text(raw.description)),
      0.96,
      patch,
      row.source_url,
    );
  }
}

function rebuildCombos(db: DatabaseSync, patch: string): void {
  db.exec("DELETE FROM combos");
  const insert = db.prepare(`
    INSERT INTO combos(slug, title, summary, entity_keys_json, champion_tags_json, goal_tags_json, score, evidence_url, evidence_note, patch, generated, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const combo of CURATED_COMBOS) {
    const keys = combo.entities
      .map((entity) => entityKeyByName(db, entity.kind, entity.name))
      .filter((key): key is string => Boolean(key));
    if (keys.length < 2) continue;
    insert.run(
      combo.slug,
      combo.title,
      combo.summary,
      JSON.stringify(keys),
      JSON.stringify(combo.championTags),
      JSON.stringify(combo.goals),
      combo.score,
      combo.evidenceUrl ?? "",
      combo.evidenceNote ?? "",
      patch,
      0,
      "curated",
    );
  }

  type MechanicEntityRow = {
    entity_key: string;
    name: string;
    tags_json: string;
    produces_json: string;
    consumes_json: string;
  };
  const rows = db.prepare(`
    SELECT entity_key, name, tags_json, produces_json, consumes_json
    FROM entities
    WHERE (kind = 'augment' OR purchasable = 1)
  `).all() as MechanicEntityRow[];
  const parsed = rows.map((row) => ({
    entity_key: row.entity_key,
    name: row.name,
    tags: JSON.parse(row.tags_json) as string[],
    produces: JSON.parse(row.produces_json) as string[],
    consumes: JSON.parse(row.consumes_json) as string[],
  }));

  const generated: Array<{ score: number; a: typeof parsed[number]; b: typeof parsed[number]; links: string[] }> = [];
  for (const a of parsed) {
    for (const b of parsed) {
      if (a.entity_key === b.entity_key) continue;
      const links = a.produces.filter((stat) => b.consumes.includes(stat));
      if (links.length === 0) continue;
      const conversionBonus = b.tags.includes("conversion") ? 12 : 0;
      const stackingBonus = a.tags.includes("stacking") ? 8 : 0;
      generated.push({ score: 42 + links.length * 12 + conversionBonus + stackingBonus, a, b, links });
    }
  }

  generated
    .sort((left, right) => right.score - left.score)
    .slice(0, 1200)
    .forEach(({ score, a, b, links }) => {
      const slug = `generated-${slugify(a.entity_key)}-${slugify(b.entity_key)}`;
      insert.run(
        slug,
        `${a.name} → ${b.name}`,
        `${a.name} supplies ${links.map((link) => link.replaceAll("_", " ")).join(", ")}, which ${b.name} consumes or scales from. Treat this as a mechanically discovered lead until an evidence timestamp or manual verification is attached.`,
        JSON.stringify([a.entity_key, b.entity_key]),
        "[]",
        JSON.stringify([...new Set([...links, ...a.tags.filter((tag) => b.tags.includes(tag))])]),
        score,
        "",
        "Generated from current tooltip producer/consumer tags.",
        patch,
        1,
        "generated",
      );
    });

  rebuildVideoCombos(db, patch);
}

async function main(): Promise<void> {
  const versions = await getJson<string[]>(VERSIONS_SOURCE);
  const patch = versions[0];
  const championSource = `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`;
  const ddragonItemsSource = `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`;
  const [arenaPayload, cdragonItems, championPayload, ddragonItemsPayload] = await Promise.all([
    getJson<JsonRecord>(ARENA_SOURCE),
    getJson<JsonRecord[]>(ITEMS_SOURCE),
    getJson<JsonRecord>(championSource),
    getJson<JsonRecord>(ddragonItemsSource),
  ]);

  const db = openDatabase();
  const augments = list(arenaPayload.augments).map((rawValue) => {
    const raw = record(rawValue);
    const id = integer(raw.id);
    const description = stripMarkup(text(raw.desc));
    const tooltip = stripMarkup(text(raw.tooltip));
    const mechanics = analyzeMechanics(text(raw.name), description, tooltip);
    const rarity = ["silver", "gold", "prismatic"][integer(raw.rarity)] ?? "unknown";
    return {
      entityKey: `augment:${id}`,
      kind: "augment" as const,
      numericId: id,
      apiName: text(raw.apiName),
      name: text(raw.name),
      rarity,
      description,
      tooltip,
      iconUrl: cdragonAsset(text(raw.iconSmall)),
      purchasable: true,
      price: 0,
      ...mechanics,
      raw,
      patch,
      sourceUrl: ARENA_SOURCE,
    };
  });

  const cdragonById = new Map(cdragonItems.map((item) => [integer(item.id), item]));
  const ddragonItems = record(ddragonItemsPayload.data);
  const items: ImportedEntity[] = Object.entries(ddragonItems)
    .filter(([, value]) => record(record(value).maps)["30"] === true)
    .map(([idValue, value]) => {
      const ddragon = record(value);
      const id = integer(idValue);
      const cdragon = cdragonById.get(id) ?? {};
      const baseId = idValue.startsWith("22") ? idValue.slice(2) : "";
      const baseItem = baseId ? record(ddragonItems[baseId]) : {};
      const gold = record(ddragon.gold);
      const image = record(ddragon.image);
      const description = stripMarkup(text(cdragon.description) || text(ddragon.description));
      const itemName = text(ddragon.name) || text(baseItem.name) || text(cdragon.name).replace(/^Item_\d+_Name$/, "");
      const mechanics = analyzeMechanics(itemName, description, text(ddragon.plaintext));
      const cdragonIcon = text(cdragon.iconPath);
      return {
        entityKey: `item:${id}`,
        kind: "item",
        numericId: id,
        apiName: "",
        name: itemName,
        rarity: id >= 440000 && id < 500000 ? "prismatic" : "item",
        description,
        tooltip: stripMarkup(text(ddragon.plaintext)),
        iconUrl: cdragonIcon
          ? cdragonAsset(cdragonIcon)
          : `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${text(image.full)}`,
        purchasable: gold.purchasable === true,
        price: integer(gold.total),
        ...mechanics,
        raw: { ...ddragon, ...cdragon },
        patch,
        sourceUrl: ddragonItemsSource,
      };
    });

  upsertEntities(db, [...augments, ...items]);
  db.prepare("DELETE FROM entities WHERE patch <> ?").run(patch);

  const championData = record(championPayload.data);
  const championInsert = db.prepare(`
    INSERT INTO champions(id, champion_key, name, title, partype, tags_json, stats_json, icon_url, patch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      champion_key=excluded.champion_key, name=excluded.name, title=excluded.title,
      partype=excluded.partype, tags_json=excluded.tags_json, stats_json=excluded.stats_json,
      icon_url=excluded.icon_url, patch=excluded.patch
  `);
  db.exec("BEGIN");
  try {
    for (const [championKey, rawValue] of Object.entries(championData)) {
      const champion = record(rawValue);
      const image = record(champion.image);
      championInsert.run(
        integer(champion.key),
        championKey,
        text(champion.name),
        text(champion.title),
        text(champion.partype),
        JSON.stringify(list(champion.tags)),
        JSON.stringify(record(champion.stats)),
        `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${text(image.full)}`,
        patch,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.prepare("DELETE FROM champions WHERE patch <> ?").run(patch);

  rebuildEdges(db, patch);
  rebuildCombos(db, patch);
  metadata(db, "patch", patch);
  metadata(db, "arena_source", ARENA_SOURCE);
  metadata(db, "items_source", ddragonItemsSource);
  metadata(db, "last_static_sync", new Date().toISOString());

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM champions) AS champions,
      (SELECT COUNT(*) FROM entities WHERE kind='augment') AS augments,
      (SELECT COUNT(*) FROM entities WHERE kind='item') AS items,
      (SELECT COUNT(*) FROM mechanic_edges) AS edges,
      (SELECT COUNT(*) FROM combos WHERE origin='curated') AS curated_combos,
      (SELECT COUNT(*) FROM combos WHERE origin='video') AS video_combos,
      (SELECT COUNT(*) FROM combos WHERE origin='generated') AS generated_combos
  `).get();
  console.log(JSON.stringify({ patch, ...counts }, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
