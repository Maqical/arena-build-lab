# Arena companion audit — 2026-08-13

## Repository feedback

GitHub currently reports no issues, pull requests, reviews, or commit comments for this repository. The latest `CI / verify` run is green. Earlier red checks remain attached to their historical commits and were caused by a stale Electron dependency lockfile.

## What public companion pages actually provide

### MetaSRC

The current champion page provides patch, region and rank filters; champion placement/pick data; augment rarity/tier/pick tables; item choices by round; prismatic choices; and a UI labelled “Select an augment build.” That last selector is the closest public analogue to Arena Build Lab's desired conditional query. The reliable product behavior should be modeled as:

`champion + selected augment set -> observed items for matching participants`

Source: https://www.metasrc.com/lol/arena/champions/riven/build

### U.GG

Public Arena champion pages advertise champion-specific items, augments and duos. Direct automated retrieval is Cloudflare/robots restricted, so this audit does not claim an internal implementation or hidden endpoint. Its visible model is primarily champion-level build guidance.

Source: https://u.gg/lol/champions/arena/LUX-arena-build

### Blitz

Blitz exposes a global augment table and champion-specific Arena pages with placement, appearance, prismatic and item statistics. Its indexed pages demonstrate separate champion, augment and item views, but do not prove that its item list is conditionally recalculated for an arbitrary selected augment set.

Sources: https://blitz.gg/lol/arena/augments and https://blitz.gg/lol/champions/camille/arena

### Porofessor

Porofessor visibly supports live lookup, lobby paste/multi-search, regions and a desktop companion. Its public homepage does not provide evidence of an Arena-specific “items given augment” selector, so this project should borrow its fast lobby workflow—not attribute unverified Arena-selection behavior to it.

Source: https://porofessor.gg/

## How augment detection differs by platform

Our captured Arena game returned:

- LCU gameflow phase: `InProgress`
- Live Client mode: `CHERRY`
- `activePlayer.fullRunes`: `{}`
- active player's `runes`: `null`
- no ordinary owned-augment ID array

The Live Client payload can indirectly reveal some augments that grant a spell—for example `Augment_ClownCollege_Deceive`—but this is not a complete general augment feed.

Overwolf documents a separate Arena Game Events Provider feature named `picked_augment`. Apps running on Overwolf can therefore receive an event unavailable to this standalone Electron app. That is not evidence of a hidden raw-LCU endpoint and it means “competitors use OCR” is too broad a claim.

Source: https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends-arena/

## Arena Build Lab implementation

- `npm run audit:lcu -- --duration=60 --interval=5` captures LCU gameflow plus Live Client `activeplayer`, `playerlist`, and `allgamedata` to the gitignored `logs/lcu_dump.json` file.
- The audit recursively reports augment/perk/rune/cherry paths and runs the same owned-augment extractor used by the overlay.
- Match-v5 remains the authoritative post-game source for participant augment IDs and final items.
- `participant_augments` is a normalized, indexed projection of immutable `riot_participants.augments_json`.
- `/api/augment-builds?championId=<id>&augmentIds=<id,id>` intersects every requested augment and aggregates items from exactly those matching participant games.
- Fewer than 20 matching games is visibly labelled `Low sample`.
- When the live APIs do not expose selected augments or the local cohort is empty, the overlay retains screenshot/manual capture and mechanical/extreme-build fallbacks.

## Remaining limitations

Match-v5 records final inventory, not precise item purchase order. Round-specific recommendations require timeline-quality purchase events or another trustworthy round field. Conditional results are only as representative as the locally ingested cohort, so sample size and provenance must remain visible.
