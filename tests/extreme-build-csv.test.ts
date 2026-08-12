import assert from "node:assert/strict";
import test from "node:test";
import { parseExtremeBuildCsv } from "../src/lib/extreme-build-csv-core";

test("parses quoted extreme-build scenarios and four augment slots", () => {
  const rows = parseExtremeBuildCsv(`objective,rank,champion,level,benchmark_score,theoretical_unbounded,status,augments,fixed_items,max_health,total_ad,ap,attack_speed,armor,mr,ability_haste,effective_cdr_percent,scenario\nmaxHealth,1,Sion,18,658207.4,true,converged,Goliath + Tank Engine + Quest: Steel Your Heart + Mind to Matter,Overlord's Bloodmail,658207.4,30229.5,0,0.829,107.4,66.85,0,0,"{""takedowns"":24,""heartsteelStacks"":48000}"\n`);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].augments, ["Goliath", "Tank Engine", "Quest: Steel Your Heart", "Mind to Matter"]);
  assert.deepEqual(rows[0].fixedItems, ["Overlord's Bloodmail"]);
  assert.equal(rows[0].stats.maxHealth, 658207.4);
  assert.equal(rows[0].scenario.heartsteelStacks, 48_000);
  assert.equal(rows[0].theoreticalUnbounded, true);
});

test("rejects a CSV without required stat columns", () => {
  assert.throws(() => parseExtremeBuildCsv("champion,augments\nSion,Goliath\n"), /missing the objective column/);
});
