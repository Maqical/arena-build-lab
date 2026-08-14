import assert from "node:assert/strict";
import test from "node:test";
import { parseLeagueLockfile } from "../src/lib/lcu/ClientConnector";
import { companionMode, extractOfferedAugmentRefs, extractOwnedAugmentRefs, extractTrackableItemRefs } from "../src/lib/lcu/GameStateMonitor";

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
    arena: { selectedAugments: [303, { apiName: "Goliath" }] },
  });
  assert.deepEqual(refs, ["augment:303", "Goliath"], "ordinary runes must not pollute owned augments");
});

test("does not mistake offered options for owned selections", () => {
  assert.deepEqual(extractOwnedAugmentRefs({ arena: { augmentOptions: [{ augmentId: 101 }, { augmentId: 202 }, { augmentId: 303 }] } }), []);
  assert.deepEqual(extractOwnedAugmentRefs({ arena: { cardOptions: [{ cardId: 1101 }, { cardId: 1102 }, { cardId: 1103 }] } }), []);
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

test("recognizes ARAM: Mayhem without treating ordinary ARAM as an augment mode", () => {
  assert.equal(companionMode({ isArena: false, queueId: 2400, queueName: "ARAM: Mayhem", liveGameMode: "ARAM" }), "aram_mayhem");
  assert.equal(companionMode({ isArena: false, queueId: null, queueName: "", liveGameMode: "KIWI" }), "aram_mayhem");
  assert.equal(companionMode({ isArena: false, queueId: 450, queueName: "ARAM", liveGameMode: "ARAM" }), null);
  assert.equal(companionMode({ isArena: true, queueId: 1740, queueName: "Arena", liveGameMode: "CHERRY" }), "arena");
});

test("extracts Mayhem card offers and selected card IDs", () => {
  assert.deepEqual(
    extractOfferedAugmentRefs("/lol-aram-mayhem/v1/card-selection", { cardOptions: [{ cardId: 1101 }, { id: 1102 }, "1103"] }),
    ["augment:1101", "augment:1102", "augment:1103"],
  );
  assert.deepEqual(extractOwnedAugmentRefs({ activePlayer: { selectedCards: [{ cardId: 1101 }, { perkId: 1102 }] } }), ["augment:1101", "augment:1102"]);
});

test("keeps real build items while excluding consumables, utility slots, and cheap components", () => {
  const refs = extractTrackableItemRefs({
    activePlayer: { summonerName: "Me#NA1" },
    allPlayers: [{
      summonerName: "Me#NA1",
      items: [
        { itemID: 1026, displayName: "Blasting Wand", price: 850, slot: 0, consumable: false },
        { itemID: 3108, displayName: "Fiendish Codex", price: 200, slot: 1, consumable: false },
        { itemID: 2052, displayName: "Poro-Snax", price: 0, slot: 6, consumable: true },
        { itemID: 6655, displayName: "Luden's Companion", price: 1_800, slot: 2, consumable: false },
      ],
    }],
  });
  assert.deepEqual(refs, ["item:1026", "item:6655"]);
});
