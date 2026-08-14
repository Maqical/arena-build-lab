# Arena companion technical audit — 2026-08-13

## Companion product patterns

Public companion products organize around the same useful loop: identify the current player and game phase, provide champion-specific context, observe live state, and turn post-game records into future recommendations. Arena Build Lab follows that model while differentiating itself through conversion math, extreme-build discovery, local provenance, and provider-neutral augment intake.

### Meta and build products

- **MetaSRC** exposes champion, augment, item, prismatic, and duo views, including a conditional augment-build concept. Arena Build Lab implements the useful query locally as `champion + selected augment set -> observed items for matching participants`.
- **U.GG** presents champion-specific Arena items, augments, and duos. Its public pages establish the expected product shape; they do not need to be a runtime dependency.
- **Blitz** provides global augment and champion-specific Arena views with placement, appearance, prismatic, and item statistics.
- **Porofessor** demonstrates the fast lobby, multi-search, match-history, and desktop-overlay workflow expected from a modern companion.
- **Overwolf** supplies a documented Game Events Provider used by desktop companions to receive supported game events without coupling UI code directly to client internals.

References:

- https://www.metasrc.com/lol/arena/champions/riven/build
- https://u.gg/lol/champions/arena/LUX-arena-build
- https://blitz.gg/lol/arena/augments
- https://porofessor.gg/
- https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/

## Verified live-data findings

### League local surfaces

LCU and Live Client Data reliably provide connection/gameflow state and, while a game is active, champion, level, live stats, and inventory. Captured Arena and Mayhem sessions did not expose a complete, stable ordinary array for the three offered cards and selected augments. Spell-granting augments can appear indirectly, but that is not a complete selection feed.

`npm run audit:lcu -- --duration=60 --interval=5` records the available LCU gameflow and Live Client payloads to gitignored diagnostics for new-patch comparison.

### Overwolf event provider

Overwolf's documented League feature set includes:

- `augments`: the three available ARAM: Mayhem augments;
- `picked_augment`: the most recently selected augment;
- `live_client_data`, item, match, and game-state updates used by companion interfaces.

Arena Build Lab v1.0.7 contains provider-neutral structured and local-visual selection adapters. The standard Electron build can recognize the verified 16:9 and 16:10 three-card layouts locally; Prismatic matching searches a bounded set of icon positions and scales and records score-only local diagnostics when confidence is insufficient. The Overwolf Electron target remains an additional structured-event distribution path.

This distinction is architectural, not a product-policy question: structured provider events are preferred when present, and local visual/manual providers feed the identical internal selection pipeline when they are not.

References:

- https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/
- https://dev.overwolf.com/ow-electron/reference/game-events/
- https://dev.overwolf.com/ow-electron/getting-started/develop-your-idea/

## Implemented data path

1. A provider emits three offer references or one picked reference.
2. `parseAugmentProviderUpdate` normalizes the documented payload shape.
3. `/api/lcu/provider-event` hands normalized events to `GameStateMonitor`.
4. The monitor maps selections into current offers and owned augments, clears stale offers after a pick, and publishes an SSE snapshot.
5. The picker and HUD resolve references through the local catalog.
6. The resolver calculates current stat deltas and the item assistant queries champion-plus-augment participant cohorts.

The same downstream path is used for Overwolf events, client-observed selections, screenshot detection, and manual confirmation. This keeps recommendation and math behavior consistent across distribution targets.

## Conditional build data

- Match-v5 is the post-game source for participant augment IDs and final items.
- `participant_augments` is the indexed projection of immutable participant selections.
- `/api/augment-builds?championId=<id>&augmentIds=<id,id>` intersects the requested augment set and aggregates items from only those matching champion games.
- Fewer than 20 exact matches is labelled `Low sample`.
- Empty exact cohorts use a champion-specific mechanical/extreme path or show that localized data is unavailable; they do not fall back to unrelated global items.
- Match-v5 final inventory does not establish precise item purchase order. Round-level ordering requires a provider event or verified timeline field.

## Execution plan

The single authoritative plan is [../ROADMAP.md](../ROADMAP.md). Immediate work is:

1. activate the tested bridge inside an Overwolf Electron target;
2. validate automatic Mayhem offer/pick flow end to end;
3. collect sanitized Arena provider inventories;
4. build the local visual provider for modes without structured selection events;
5. compare resolver predictions with observed before/after live stats.
