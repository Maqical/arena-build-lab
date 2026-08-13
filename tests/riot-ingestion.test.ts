import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseRiotMatch } from "../src/lib/riot/arena-match";
import { insertLiveObservation, mergeObservedMaxima } from "../src/lib/live-observations";
import { calculateMeta } from "../src/lib/meta-aggregation";
import { cohortMembers, ingestCohortMember, insertParsedMatch, upsertCohortMember } from "../src/lib/riot/ingestion";
import { parseRiotId, platformFromTagLine, RiotApiClient } from "../src/lib/riot/riot-api";
import { SCHEMA_SQL } from "../src/lib/schema";
import { queryBuildsForAugments } from "../src/lib/augment-build-query";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/riot_match_sample.json", import.meta.url), "utf8")) as unknown;

test("parses Arena augment, item, placement, and final-stat fields", () => {
  const match = parseRiotMatch(fixture, { routingRegion: "asia", platform: "kr" });
  assert.equal(match.matchId, "KR_1234567890");
  assert.equal(match.patch, "16.15");
  assert.equal(match.queueId, 1740);
  assert.equal(match.gameMode, "CHERRY");
  assert.equal(match.participantCount, 2);
  assert.deepEqual(match.participants[0].augmentIds, [137000, 137101, 137202, 137303]);
  assert.deepEqual(match.participants[0].itemIds, [3083, 3748, 4401, 3340]);
  assert.equal(match.participants[0].placement, 1);
  assert.equal(match.participants[0].subteamId, 1);
  assert.equal(match.participants[0].finalStats.totalDamageTaken, 142300);
  assert.deepEqual(match.participants[1].augmentIds, [137404, 137505]);
  assert.equal(match.participants[1].placement, 2);
});

test("handles missing optional participant fields without inventing values", () => {
  const sparse = structuredClone(fixture) as { info: { participants: Array<Record<string, unknown>> } };
  sparse.info.participants[0] = { participantId: 1, championId: 14, championName: "Sion" };
  const participant = parseRiotMatch(sparse, { routingRegion: "asia", platform: "kr" }).participants[0];
  assert.equal(participant.puuid, "");
  assert.equal(participant.placement, null);
  assert.equal(participant.subteamId, null);
  assert.deepEqual(participant.augmentIds, []);
  assert.deepEqual(participant.itemIds, []);
  assert.deepEqual(participant.finalStats, {});
});

test("stores immutable matches once and never duplicates participants", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  const match = parseRiotMatch(fixture, { routingRegion: "asia", platform: "kr" });
  assert.equal(insertParsedMatch(db, match, "2026-08-12T00:00:00.000Z"), true);
  assert.equal(insertParsedMatch(db, match, "2026-08-13T00:00:00.000Z"), false);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM riot_matches").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM riot_participants").get() as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM participant_augments").get() as { count: number }).count, 6);
  db.prepare(`INSERT INTO entities(entity_key,kind,numeric_id,api_name,name,rarity,description,tooltip,icon_url,purchasable,price,tags_json,produces_json,consumes_json,raw_json,patch,source_url)
    VALUES ('item:3083','item',3083,'WarmogsArmor','Warmog''s Armor','','','','https://example.test/3083.png',1,3100,'[]','[]','[]','{}','test','fixture')`).run();
  const build = queryBuildsForAugments(db, 14, [137000]);
  assert.equal(build.sampleSize, 1);
  assert.equal(build.lowSample, true);
  assert.equal(build.items.find((item) => item.numericId === 3083)?.pickRate, 1);
  db.close();
});

test("checkpointed ingestion can rerun the same Riot history without duplicates", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("/ids?") ? ["KR_1234567890"] : fixture;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  upsertCohortMember(db, {
    cohortId: "kr-test",
    puuid: "sample-puuid-one",
    platform: "kr",
    routingRegion: "asia",
    gameName: "",
    tagLine: "",
    seedMethod: "test_fixture",
  });
  const client = new RiotApiClient("test-key", fakeFetch);
  const first = await ingestCohortMember(db, client, cohortMembers(db, "kr-test")[0], { count: 1 });
  const second = await ingestCohortMember(db, client, cohortMembers(db, "kr-test")[0], { count: 1 });
  assert.equal(first.insertedMatches, 1);
  assert.equal(second.insertedMatches, 0);
  assert.equal(second.alreadyStored, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM riot_matches").get() as { count: number }).count, 1);
  assert.ok((db.prepare("SELECT last_checked_at FROM cohort_members").get() as { last_checked_at: string }).last_checked_at);
  db.close();
});

test("waits for Riot's Retry-After header and retries a 429 response", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const client = new RiotApiClient("test-key", fakeFetch, async (milliseconds) => { waits.push(milliseconds); });
  assert.deepEqual(await client.requestJson("americas", "/test"), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
});

test("parses Riot IDs and infers common platform tags", () => {
  assert.deepEqual(parseRiotId("Player Name#NA1"), { gameName: "Player Name", tagLine: "NA1" });
  assert.equal(platformFromTagLine("KR1"), "kr");
  assert.throws(() => parseRiotId("missing-tag"), /Game Name#Tag/);
});

test("records peak live stats without losing an earlier transient maximum", () => {
  const first = {
    currentHealth: 1000, maxHealth: 500000, attackDamage: 9000, abilityPower: 20,
    attackSpeed: 1.2, armor: 400, magicResistance: 300, moveSpeed: 450, abilityHaste: 120,
  };
  const peak = mergeObservedMaxima(first, { ...first, maxHealth: 660000, attackDamage: 8500, abilityPower: 200 });
  assert.equal(peak.maxHealth, 660000);
  assert.equal(peak.attackDamage, 9000);
  assert.equal(peak.abilityPower, 200);

  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  const id = insertLiveObservation(db, {
    championId: 14,
    championName: "Sion",
    augmentIds: ["augment:1", "augment:2", "augment:1"],
    maxima: peak,
    queueId: 1740,
    startedAt: "2026-08-12T00:00:00.000Z",
    endedAt: "2026-08-12T00:20:00.000Z",
  });
  const row = db.prepare("SELECT * FROM live_observations WHERE id = ?").get(id) as Record<string, unknown>;
  assert.equal(row.observed_max_hp, 660000);
  assert.equal(row.observed_max_ad, 9000);
  assert.equal(row.augment_ids_json, '["augment:1","augment:2"]');
  db.close();
});

test("aggregates local first-place, top-four, and pick-rate snapshots idempotently", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arena-meta-"));
  const filename = path.join(directory, "arena.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA_SQL);
  const match = parseRiotMatch(fixture, { routingRegion: "asia", platform: "kr" });
  insertParsedMatch(db, match);
  const second = structuredClone(match);
  second.matchId = "KR_1234567891";
  const fixtureRecord = fixture as { metadata: Record<string, unknown> };
  second.rawJson = JSON.stringify({ ...fixtureRecord, metadata: { ...fixtureRecord.metadata, matchId: second.matchId } });
  second.rawJsonHash = "second-hash";
  second.participants = second.participants.map((participant) => ({ ...participant, placement: participant.placement === 1 ? 2 : 1, won: participant.placement !== 1 }));
  insertParsedMatch(db, second);
  db.close();
  const summary = calculateMeta(filename);
  const output = new DatabaseSync(filename, { readOnly: true });
  const stats = output.prepare(`
    SELECT metric, value, sample_size FROM meta_snapshots
    WHERE entity_key = 'augment:137000' AND champion_id IS NULL
  `).all() as Array<{ metric: string; value: number; sample_size: number }>;
  assert.equal(summary.matches, 2);
  assert.equal(stats.find((row) => row.metric === "win_rate")?.value, 0.5);
  assert.equal(stats.find((row) => row.metric === "top4_rate")?.value, 1);
  assert.equal(stats.find((row) => row.metric === "win_rate")?.sample_size, 2);
  const firstCount = Number((output.prepare("SELECT COUNT(*) AS count FROM meta_snapshots").get() as { count: number }).count);
  output.close();
  calculateMeta(filename);
  const rerun = new DatabaseSync(filename, { readOnly: true });
  const secondCount = Number((rerun.prepare("SELECT COUNT(*) AS count FROM meta_snapshots").get() as { count: number }).count);
  rerun.close();
  assert.equal(secondCount, firstCount);
  fs.rmSync(directory, { recursive: true, force: true });
});
