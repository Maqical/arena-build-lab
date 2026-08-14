# Arena Build Lab v1.0.5

v1.0.5 adds local automatic selection-screen recognition and Prismatic item guidance to the Frbz.gg Arena and ARAM: Mayhem companion.

## Shipped

- Player-facing patch labels such as `26.16`, with the raw Data Dragon build retained separately.
- Provider-neutral augment event parsing and a local provider bridge.
- Live LCU/Live Client state, automatic reconnect, persistent overlay placement, and tray controls.
- Local three-card layout detection with temporal confirmation and catalog icon matching for augments and Prismatic items.
- Prismatic choice cards with champion-specific stat deltas, a highlighted recommendation, cohort provenance, and continuation build paths.
- Multi-monitor capture follows the display containing the selection cursor.
- Screenshot/manual picker integration with the owned-augment HUD pipeline.
- Recursive stat resolver, extreme-build engine, champion-scoped item recommendations, local meta aggregation, history, and trophies.
- Froobs, LLC. Windows publisher metadata and Frbz.gg product branding.
- Responsive build-lab controls that remain inside narrow windows.

## Verification

- ESLint passed.
- TypeScript type checking passed.
- 56 unit tests passed.
- Next.js production build passed.
- The deterministic UI smoke suite passed with zero console errors, including three augment offers and three Prismatic item offers.
- The Windows NSIS installer is built locally and must pass the installed live-game gate before any GitHub release.

## Installer

`Arena-Build-Lab-1.0.5-Setup.exe`

SHA-256: `9E6F89642CDA372C23FF4F3C934045CF78A1009C557ABA4D48D41BD8AAFA22DC`

The next implementation milestones are tracked in [ROADMAP.md](ROADMAP.md).
