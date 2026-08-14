# Arena Build Lab Master Roadmap

This is the authoritative implementation plan after v1.0.7. Issues and release work should link back to one of the milestones below instead of creating parallel plans.

## Product objective

Turn live Arena and ARAM: Mayhem state into an immediate, explainable answer to four questions:

1. What augment choices are on screen, and which one was selected?
2. What does each choice do to this champion and current build mathematically?
3. Which items and future augments reinforce the selected conversion path?
4. How unusual was the completed build compared with the player's baseline and local cohort?

The companion remains read-only. Automatic observation is in scope; automated gameplay input is not.

## Product operating model — the Frbz synthesis

Arena Build Lab takes the strongest recurring companion patterns and implements them around Arena and ARAM: Mayhem rather than cloning another product's presentation:

- **Before play:** champion/build context, duo context, and clear readiness/patch state.
- **At each decision:** recognize the three choices, compare immediate stat effects, explain synergy, and show multiple viable continuation paths.
- **During play:** maintain an observed timeline for owned selections, inventory, round state, and peak stats.
- **After play:** compare predictions with observed results, surface personal records, and turn discrepancies into formula/data work.
- **Across sessions:** learn from the local warehouse and creator/cohort evidence while retaining source, patch, region, and sample size.

The release blocker is selection completeness: augment cards and Prismatic-item offers must both reach an explanation and build path during the choice window. Broader coaching features follow that gate.

## Current baseline — v1.0.7

- Windows Electron installer, tray integration, persistent overlay placement, and automatic LCU reconnection.
- Command Center, live view, overlay, Build Lab, history, trophies, extreme builds, and settings.
- LCU/Live Client state for phase, champion, stats, and items.
- Local three-card visual recognition for augment and Prismatic-item offers, plus manual and screenshot-assisted fallbacks. Prismatic matching now searches bounded icon positions/scales and writes score-only local diagnostics on uncertain screens.
- Provider-neutral augment parser and local provider-event endpoint.
- Tested parsing for Overwolf's documented Mayhem `augments` and `picked_augment` payloads.
- Immutable 1,075-match local warehouse with 18,438 participant rows.
- Player-facing patch labels separated from raw Data Dragon build versions.
- Fixed-point resolver, extreme-build search, conditional item recommendations, Prismatic choice comparison, and uncatalogued-ID handling.

## Milestone 1 — Automatic Mayhem augment intake

Goal: an offered or selected Mayhem augment reaches the HUD and resolver without keyboard input.

### Tasks

- Add an Overwolf Electron distribution target using the Game Events Provider.
- Request the `augments`, `live_client_data`, and `match_info` features at startup.
- Forward `new-info-update` and `new-game-event` payloads through the existing provider-event endpoint.
- Resolve provider names to canonical catalog IDs using normalized name, alias, and numeric-ID indexes.
- Persist a session event journal containing provider, timestamp, raw reference, canonical ID, and mapping confidence.
- Push three offers into the picker automatically.
- Push `picked_augment` into owned augments, clear the offer state, re-run the resolver, and refresh champion-scoped item recommendations.
- Add replay fixtures for offer, pick, duplicate, delayed, malformed, and out-of-order events.

### Acceptance gate

- Offer cards appear within two seconds of the provider event.
- A picked augment appears in Owned Augments within two seconds.
- The overlay returns to the live HUD after a pick rather than retaining stale offers.
- Duplicate provider events do not duplicate owned augments.
- Item recommendations remain scoped to the current champion and selected augment set.
- A complete live Mayhem match produces an event journal with no uncaught UI errors.

## Milestone 2 — Arena provider validation

Goal: determine and implement the best automatic Arena selection source without weakening the Mayhem path.

### Tasks

- Capture sanitized event inventories for Arena champion select, augment rounds, combat, and post-game.
- Test LCU, Live Client Data, and provider events independently; record exact source and payload path.
- Add an Arena adapter when a stable offer/pick event is observed.
- Keep screenshot/manual intake on the same canonical selection pipeline so math behavior is identical across providers.
- Show a compact diagnostics drawer: connection, mode, provider, last event time, raw reference, mapping result, and resolver run ID.

### Acceptance gate

- The UI never claims automatic Arena detection unless the current session produced a verified offer or pick event.
- A real selection, regardless of source, produces the same canonical augment ID and resolver result.
- Sanitized replay tests cover every verified Arena payload shape.

## Milestone 3 — Local visual selection provider (implemented; validation expansion remains)

Goal: provide standalone automatic detection when no structured event feed is available.

### Tasks

- Collect sanitized screenshots for supported resolutions, display scaling, UI scaling, and languages.
- Detect the three card regions locally before classification. **Implemented.**
- Match augment and Prismatic item icon fingerprints against the local catalog; require confidence thresholds and temporal agreement across frames. **Implemented for validated 16:9 and 16:10 card layouts.**
- Process only while a supported game is active and a selection-screen signature is present.
- Keep pixels ephemeral by default; store only opt-in sanitized diagnostics.
- Emit the same provider-neutral offer/pick events used by Overwolf and manual input. **Implemented.**
- Expand the sanitized validation set across resolutions, display/UI scaling, languages, and multi-monitor arrangements.
- Display uncertain matches for one-click confirmation instead of silently choosing.

### Acceptance gate

- At least 99% offer-card recall and 99.5% title precision on the sanitized validation set.
- CPU usage remains bounded during ordinary gameplay and capture stops outside selection windows.
- No frame or screenshot is persisted without an explicit diagnostics opt-in.
- Low-confidence recognition never becomes an owned augment automatically.

## Milestone 4 — Build math validation harness

Goal: make live sessions prove that the resolver and conversion chains agree with observed game state.

### Tasks

- Snapshot baseline stats before each selection and live stats after each selection.
- Attach resolver inputs, outputs, assumptions, iteration count, and convergence status to a run ID.
- Compare predicted deltas with observed deltas using per-stat tolerances.
- Separate permanent stats, round-only buffs, combat-condition effects, anvils, quests, and stack inputs.
- Add a discrepancy viewer that explains missing catalog data or scenario inputs instead of hiding the difference.
- Promote verified formulas to curated status only after fixture and live-observation agreement.

### Acceptance gate

- Every live resolver result is reproducible from its stored inputs.
- No NaN, Infinity, duplicate stat line, or unresolved conversion cycle reaches the HUD.
- Differences outside tolerance are visible and traceable to a formula, assumption, or missing live input.

## Milestone 5 — Observed-player context

Goal: provide the fast situational context expected from a modern companion app using information supplied by the active provider.

### Tasks

- Show lobby/player identity, rank when available, recent Arena/Mayhem history, mains, and average placement.
- Maintain an observed inventory ledger with item, first-seen time, last-seen time, and source.
- Present opponent item deltas and last-observed timestamps without inventing unseen state.
- Add self-planning hints using the player's own gold, inventory, round timer, and recommended purchase path.
- Add a phase-aware event timeline modeled around actionable observations: round start, selection, purchase, opponent item first-seen, combat start/end, and personal stat peak.
- Where a mode exposes lane state, show last-observed opponent inventory and return timing as observations with timestamps; never present an estimate as a newly observed fact.
- Compute duo synergy from same-team participant records with patch, region, and sample-size provenance.
- Keep all network fetches queued, cached, and rate-limit aware.

### Acceptance gate

- Every displayed fact includes a source and observation time internally.
- Unknown or stale information is labelled rather than inferred as current.
- Lobby and live panels remain responsive under API throttling or missing player data.

## Milestone 6 — Recommendation quality

Goal: answer `champion + owned augments + owned items + objective` with useful, explainable paths.

### Tasks

- Rank exact champion/augment-set cohorts before partial-set cohorts.
- Combine observed cohort choices with resolver-derived mechanical paths without mixing their provenance.
- Remove global-item fallbacks from champion-specific views.
- Add objective controls for health, AD, AP, attack speed, haste, movement, crit, on-hit, durability, and balanced placement.
- Explain conversion order, scenario inputs, marginal stat gain, sample size, and patch age.
- Track personal outcomes separately from cohort aggregates.
- Add a compact voice/text question surface only after the same query can be answered deterministically by the local recommendation API.

### Acceptance gate

- No recommendation leaks items or augments from another champion through a generic fallback.
- Low samples remain visible and never masquerade as a stable ranking.
- Every recommendation explains whether it is observed, mechanically derived, curated, or video-derived.

## Release discipline

Before each installer:

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run test:ui
npm run test:uncatalogued
npm run electron:build
```

Then verify:

- installer publisher, product name, version, and icon;
- upgrade preserves `%APPDATA%\Arena Build Lab`;
- only the intended installed version is registered;
- dashboard patch label and raw data build are both correct;
- LCU reconnect, provider status, picker-to-HUD state, and item filtering;
- repository secret sweep and clean tracked working tree;
- no GitHub push or release tag until the installed build passes a real-game test.

## Documentation ownership

- `README.md`: installation, operation, architecture summary, and developer commands.
- `ROADMAP.md`: authoritative future plan and acceptance gates.
- `RELEASE_NOTES.md`: shipped behavior only.
- `docs/arena-companion-audit.md`: dated technical evidence and provider findings.
