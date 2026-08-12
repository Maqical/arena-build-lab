import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMechanics, stripMarkup } from "../src/lib/mechanics";

test("strips League tooltip markup without losing readable text", () => {
  assert.equal(stripMarkup("<mainText>Gain <attention>50</attention> Health<br>Forever.</mainText>"), "Gain 50 Health Forever.");
});

test("detects a mana to health conversion", () => {
  const result = analyzeMechanics("Increase max Health based on your max Mana.");
  assert(result.tags.includes("health"));
  assert(result.tags.includes("mana"));
  assert(result.tags.includes("conversion"));
  assert(result.produces.includes("health"));
  assert(result.consumes.includes("mana"));
});

test("detects AP and haste conversion themes", () => {
  const result = analyzeMechanics("Gain Ability Haste equal to 30% Ability Power.");
  assert(result.produces.includes("ability_haste"));
  assert(result.consumes.includes("ability_power"));
});

test("recognizes abbreviated stats at word boundaries", () => {
  const result = analyzeMechanics("Gain 30 AP and 40 Armor, then gain MR based on AP.");
  assert(result.tags.includes("ability_power"));
  assert(result.tags.includes("armor"));
  assert(result.tags.includes("magic_resist"));
  assert(!analyzeMechanics("Tap an enemy").tags.includes("ability_power"));
});
