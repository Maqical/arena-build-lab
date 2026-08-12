import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const baseUrl = process.env.ARENA_BASE_URL ?? "http://localhost:3000";
const db = new DatabaseSync(process.env.ARENA_DB_PATH ?? "data/arena.sqlite", { readOnly: true });
const champions = db.prepare("SELECT champion_key AS championKey, name FROM champions ORDER BY name").all();
const championNames = new Set(champions.map((champion) => champion.name));
const entities = db.prepare("SELECT entity_key AS entityKey, name FROM entities WHERE trim(name) <> '' ORDER BY entity_key").all();

async function combos(params) {
  const response = await fetch(`${baseUrl}/api/combos?${new URLSearchParams({
    curated: "false",
    limit: "100",
    ...params,
  })}`);
  assert.equal(response.status, 200, `API failed: ${response.url}`);
  return (await response.json()).combos;
}

function assertNoChampionLeak(results, selectedChampion, context) {
  for (const combo of results) {
    const specificChampions = combo.championTags.filter((tag) => championNames.has(tag));
    assert(
      specificChampions.length === 0 || specificChampions.includes(selectedChampion),
      `${context}: ${combo.title} is tagged for ${specificChampions.join(", ")}, not ${selectedChampion}`,
    );
  }
}

function assertNoDuplicates(results, context) {
  const keys = results.map((combo) => [...combo.entityKeys].sort().join("|"));
  assert.equal(new Set(keys).size, keys.length, `${context}: duplicate entity sets were returned`);
}

async function runPool(values, worker, concurrency = 12) {
  let cursor = 0;
  const jobs = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await worker(values[index], index);
    }
  });
  await Promise.all(jobs);
}

try {
  const health = await fetch(`${baseUrl}/api/combos?limit=1`);
  assert.equal(health.status, 200, `Start Arena Build Lab first: npm run dev (${baseUrl})`);

  let resultCardsChecked = 0;
  await runPool(entities, async (entity, index) => {
    const champion = champions[index % champions.length];
    const results = await combos({ owned: entity.entityKey, champion: champion.championKey });
    for (const combo of results) {
      assert(combo.entityKeys.includes(entity.entityKey), `${entity.name}: result does not contain the owned entity: ${combo.title}`);
    }
    assertNoChampionLeak(results, champion.name, `${champion.name} + ${entity.name}`);
    assertNoDuplicates(results, `${champion.name} + ${entity.name}`);
    resultCardsChecked += results.length;
  });

  await runPool(champions, async (champion) => {
    const results = await combos({ champion: champion.championKey });
    assertNoChampionLeak(results, champion.name, champion.name);
    assertNoDuplicates(results, champion.name);
    resultCardsChecked += results.length;
  });

  console.log(JSON.stringify({
    championsAudited: champions.length,
    ownedEntitiesAudited: entities.length,
    APIQueries: champions.length + entities.length,
    resultCardsChecked,
    ownershipLeaks: 0,
    championLeaks: 0,
    duplicateEntitySets: 0,
  }, null, 2));
} finally {
  db.close();
}
