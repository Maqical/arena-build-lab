import assert from "node:assert/strict";
import test from "node:test";
import { displayPatchVersion } from "../src/lib/patch-version";

test("presents modern Data Dragon builds as player-facing patch labels", () => {
  assert.equal(displayPatchVersion("16.16.1"), "26.16");
  assert.equal(displayPatchVersion("15.24.1"), "25.24");
});

test("preserves legacy and unknown patch labels", () => {
  assert.equal(displayPatchVersion("14.24.1"), "14.24");
  assert.equal(displayPatchVersion("not synced"), "not synced");
});
