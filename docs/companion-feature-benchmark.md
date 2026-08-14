# Companion feature benchmark and Frbz synthesis

Updated: 2026-08-14

This document converts public companion-product patterns into Arena Build Lab requirements. It is product research, not a dependency list or a plan to reproduce another product's branding.

## Strong patterns worth adopting

| Pattern | Public example | Frbz implementation |
| --- | --- | --- |
| Client-aware desktop lifecycle | YOUR.GG describes a desktop app that connects to the League client and activates around matches. | Existing LCU lifecycle, reconnect state, phase router, tray, and overlay. |
| Pre-game matchup and build context | YOUR.GG advertises matchup metrics, team-composition strategy, and pro/one-trick build recommendations. | Champion-select panel backed by local history, curated mechanics, and source-labelled cohort evidence. |
| Decision-time overlay | YOUR.GG advertises decision support and Mayhem augment overlays. | Three-choice augment/card and Prismatic panels with stat deltas, synergy explanation, and continuation paths. |
| Event timeline | YOUR.GG lists objective-fight advantage, core-item timing, opponent return, and critical-item detection. | Provider-neutral observed-event ledger: round state, purchases, opponent items first/last seen, and personal peaks. |
| Voice questions | YOUR.GG advertises in-game build and Mayhem item Q&A. | Later milestone: a thin voice/text layer over deterministic local recommendation APIs, with the same provenance as the visual UI. |
| Personalized review | YOUR.GG PLAYREPORT compares player behavior and produces improvement directions. | Prediction-versus-observation reports, trophy history, build-path outcomes, and resolver discrepancy review. |
| Fast lobby/multi-search workflow | Common across desktop companions. | Cached Riot-ID/PUUID lookup, recent mode history, champion familiarity, and duo context without blocking the overlay. |

## Product priorities

1. **Selection reliability:** recognize every supported three-card and Prismatic choice, publish it within the decision window, and show uncertainty instead of silence.
2. **Build-path usefulness:** every recognized choice must produce immediate deltas, synergy notes, and at least one champion-scoped continuation or an honest no-data state.
3. **Observed timeline:** record source and time for selections, inventory changes, rounds, and peaks so the HUD and post-game review tell the same story.
4. **Personal coaching:** compare predicted and observed results, identify missing scenario inputs, and turn repeated outcomes into actionable experiments.
5. **Platform breadth:** add mode-specific panels only through provider adapters; keep the catalog, resolver, recommendation, and evidence layers shared.

## Implementation boundary

Arena Build Lab observes supported client/provider state and on-screen choices, analyzes them locally, and presents multiple decisions with evidence. It does not send gameplay input or represent unobserved state as fact. This boundary is encoded once here and in the README so routine feature work can focus on engineering.

## Public references

- YOUR.GG membership and overlay features: https://your.gg/en/na/membership
- Riot general product policy: https://developer.riotgames.com/policies/general
- Riot League developer documentation: https://developer.riotgames.com/docs/lol
- Overwolf League game-event features: https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/
