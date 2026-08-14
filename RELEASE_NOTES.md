# Arena Build Lab v1.0.7

v1.0.7 hardens automatic Prismatic-item recognition and repairs the local installation after an interrupted v1.0.6 upgrade.

## Shipped

- Player-facing patch labels such as `26.16`, with the raw Data Dragon build retained separately.
- Provider-neutral selection intake for Arena augments, Mayhem cards, and Prismatic items.
- Local three-card layout detection supporting validated 16:9 and 2304x1440 (16:10) layouts.
- Multi-position and multi-scale Prismatic icon matching against the 47-item local catalog.
- Score-only local selection diagnostics for uncertain matches; gameplay frames remain ephemeral by default.
- Prismatic choice cards with champion-specific stat deltas, a highlighted recommendation, cohort provenance, and continuation paths.
- Live LCU/Live Client state, automatic reconnect, persistent overlay placement, and tray controls.
- Recursive stat resolver, extreme-build engine, champion-scoped item recommendations, local aggregation, history, and trophies.
- Froobs, LLC. Windows publisher metadata and Frbz.gg product branding.

## Release gate

The installer remains local until a real match confirms that both an augment/card offer and a Prismatic-item offer reach the overlay and recommendation path.

## Installer

`Arena-Build-Lab-1.0.7-Setup.exe`

SHA-256: `90B7E3A46F81E0BAE39F268D1E768D225275B74C83C963F9C13AA29E5FF3904D`

The implementation milestones are tracked in [ROADMAP.md](ROADMAP.md).
