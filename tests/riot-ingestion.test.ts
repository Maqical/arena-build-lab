import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseRiotMatch } from "../src/lib/riot/arena-match";
import { insertLiveObservation, mergeObservedMaxima } from "../src/lib/live-observations";
import { cohortMembers, ingestCohortMember, insertParsedMatch, upsertCohortMember } from "../src/lib/riot/ingestion";
import { parseRiotId, platformFromTagLine, RiotApiClient } from "../src/lib/riot/riot-api";
import { SCHEMA_SQL } from "../src/lib/schema";

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
