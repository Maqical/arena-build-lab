# Arena Build Lab v1.0.4

v1.0.4 is the current locally verified Windows release of the Frbz.gg Arena and ARAM: Mayhem companion.

## Shipped

- Player-facing patch labels such as `26.16`, with the raw Data Dragon build retained separately.
- Provider-neutral augment event parsing and a local provider bridge.
- Parsing tests for documented Mayhem `augments` and `picked_augment` events.
- Live LCU/Live Client state, automatic reconnect, persistent overlay placement, and tray controls.
- Screenshot/manual picker integration with the owned-augment HUD pipeline.
- Recursive stat resolver, extreme-build engine, champion-scoped item recommendations, local meta aggregation, history, and trophies.
- Froobs, LLC. Windows publisher metadata and Frbz.gg product branding.

## Verification

- ESLint passed.
- TypeScript type checking passed.
- 54 unit tests passed.
- Next.js production build passed.
- UI and uncatalogued-selection tests passed.
- The Windows NSIS installer built, installed, launched, and connected to the local League client.
- Upgrade preserved 1,075 matches and 18,438 participant records in the local warehouse.

## Installer

`Arena-Build-Lab-1.0.4-Setup.exe`

SHA-256: `44A30759C9ED4F2D572C9ED24D97A982530215F7D794C6D72AC54379CCF7A8F2`

The next implementation milestones are tracked in [ROADMAP.md](ROADMAP.md).
