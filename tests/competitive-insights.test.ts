import assert from "node:assert/strict";
import test from "node:test";
import { performanceGrade, performanceScore, tierForRank } from "../src/lib/competitive-insights-core";

test("performance scoring rewards placement while keeping every component bounded", () => {
  const excellent = performanceScore({ placement: 1, kdaRatio: 2, damageRatio: 1.8, mitigatedRatio: 1.4, augmentQuality: 1 });
  const poor = performanceScore({ placement: 4, kdaRatio: 0, damageRatio: 0, mitigatedRatio: 0, augmentQuality: 0 });
  assert.ok(excellent >= 95 && excellent <= 100);
  assert.equal(poor, 0);
  assert.equal(performanceGrade(excellent), "S+");
  assert.equal(performanceGrade(poor), "D");
});

test("tier rank buckets are deterministic for small and large cohorts", () => {
  assert.equal(tierForRank(0, 100), "S");
  assert.equal(tierForRank(12, 100), "A");
  assert.equal(tierForRank(99, 100), "D");
  assert.equal(tierForRank(0, 1), "S");
});
