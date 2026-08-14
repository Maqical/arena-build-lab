import assert from "node:assert/strict";
import test from "node:test";
import { parseAugmentProviderUpdate } from "../src/lib/augment-provider";

test("parses documented Overwolf Mayhem augment offers", () => {
  const update = parseAugmentProviderUpdate({
    feature: "augments",
    category: "me",
    key: "augments",
    value: JSON.stringify({ augment_1: { name: "Scopier Weapons" }, augment_2: { name: "Rabble Rousing" }, augment_3: { name: "Soul Eater" } }),
  });
  assert.deepEqual(update, { offered: ["Scopier Weapons", "Rabble Rousing", "Soul Eater"], picked: null });
});

test("parses documented Overwolf picked augment updates", () => {
  assert.deepEqual(parseAugmentProviderUpdate({ feature: "augments", category: "me", key: "picked_augment", value: "Rabble Rousing" }), { offered: [], picked: "Rabble Rousing" });
});
