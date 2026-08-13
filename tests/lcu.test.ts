import assert from "node:assert/strict";
import test from "node:test";
import { parseLeagueLockfile } from "../src/lib/lcu/ClientConnector";
import { extractOfferedAugmentRefs, extractOwnedAugmentRefs } from "../src/lib/lcu/GameStateMonitor";

test("parses a valid League lockfile without losing authentication fields", () => {
  const parsed = parseLeagueLockfile("LeagueClient:1234:54321:secret-token:https", "C:/Riot/lockfile");
  assert.deepEqual(parsed, {
    processName: "LeagueClient",
    processId: 1234,
    port: 54321,
    password: "secret-token",
    protocol: "https",
    lockfilePath: "C:/Riot/lockfile",
  });
});

test("rejects malformed League lockfiles", () => {
  assert.throws(() => parseLeagueLockfile("LeagueClient:not-a-pid:0::https", "bad-lockfile"), /Invalid League lockfile/);
});

test("extracts only explicitly named three-option Arena augment offers", () => {
  assert.deepEqual(
    extractOfferedAugmentRefs("/lol-cherry/v1/augment-selection", {
      round: 4,
      augmentOptions: [{ augmentId: 101 }, { id: 202 }, "303"],
    }),
    ["augment:101", "augment:202", "augment:303"],
  );

  assert.deepEqual(
    extractOfferedAugmentRefs("/lol-store/v1/catalog", { choices: [101, 202, 303] }),
    [],
    "an unrelated three-item array must not be treated as an augment offer",
  );

  assert.deepEqual(
    extractOfferedAugmentRefs("/lol-cherry/v1/augment-selection", [101, 202, 303]),
    ["augment:101", "augment:202", "augment:303"],
  );
});

test("extracts selected augments from observed live-client shapes", () => {
  const refs = extractOwnedAugmentRefs({
    activePlayer: { generalRunes: [{ id: 101 }, { perkId: 202 }] },
    arena: { augments: [303, { apiName: "Goliath" }] },
  });
  assert.deepEqual(refs, ["augment:101", "augment:202", "augment:303", "Goliath"]);
});

test("recognizes an augment-backed Arena summoner spell on the active player", () => {
  const refs = extractOwnedAugmentRefs({
    activePlayer: { summonerName: "Player#NA1", fullRunes: {} },
    allPlayers: [{
      summonerName: "Player#NA1",
      runes: null,
      summonerSpells: {
        summonerSpellTwo: { rawDescription: "GeneratedTip_Spell_Augment_ClownCollege_Deceive_Description" },
      },
    }],
  });
  assert.deepEqual(refs, ["ClownCollege"]);
});

test("does not collect augment-like data from opposing player records", () => {
  const refs = extractOwnedAugmentRefs({
    activePlayer: { summonerName: "Me#NA1", fullRunes: {} },
    allPlayers: [
      { summonerName: "Me#NA1", runes: null },
      { summonerName: "Opponent#NA1", arenaAugments: [101, 202] },
    ],
  });
  assert.deepEqual(refs, []);
});
