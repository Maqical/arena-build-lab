# Arena Build Lab v1.0.0

Arena Build Lab v1.0.0 is the first packaged Windows release of the local-first Arena and ARAM: Mayhem companion.

## Highlights

- **Live companion overlay** — follows supported local client game states, displays the active champion, items, owned augments when available, live stats, and build guidance in a movable always-on-top window.
- **Stat conversion engine** — resolves recursive conversion chains with convergence safeguards and powers reproducible extreme-build searches across health, attack damage, ability power, attack speed, and related stats.
- **AI augment picker** — compares three manual or screenshot-detected augment choices, shows deterministic stat deltas, and optionally adds a concise AI recommendation when an API key is configured.
- **Local data warehouse** — stores match and participant records immutably, derives patch- and region-aware local meta snapshots, and keeps personal history on the user's machine.
- **Build Lab and trophy case** — explores conversion paths and extreme builds, reviews recent matches, and preserves locally observed peak-stat records.
- **Desktop experience** — includes a Windows installer, system-tray controls, persistent overlay placement, appearance settings, packaged data workers, reconnect handling, and patch-awareness.

## Privacy and operation

API keys and personal match data remain in the app's local user-data directory. The companion uses read-only local client surfaces and user-triggered screenshot analysis; it does not inject into the game process or automate gameplay.

## Installation

Download `Arena-Build-Lab-1.0.0-Setup.exe`, run the installer, then open Settings to configure optional API integrations. The first launch initializes the local database and game-data catalog in the background.

## Verification

The release passed the TypeScript test suite, linting, type checking, production Next.js build, UI smoke tests, a 1,000-match local warehouse stress test, and a 500-combination resolver stress test before packaging.
