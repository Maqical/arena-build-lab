# Arena Build Lab

Arena Build Lab is a Windows companion for League of Legends Arena and ARAM: Mayhem, built by Frbz.gg and published by Froobs, LLC.

It combines live game context, automatic and assisted augment intake, recursive stat-conversion math, champion-specific build guidance, personal match history, and a local match warehouse. The application is read-only: it observes supported game/client data and never controls gameplay.

Current desktop version: **v1.0.5**

## Install

Run `Arena-Build-Lab-1.0.5-Setup.exe`. The installer creates Start Menu and desktop shortcuts and preserves the local warehouse under `%APPDATA%\Arena Build Lab` during upgrades.

On first launch:

1. Open **Settings** from the dashboard or tray menu.
2. Add a Riot API key to sync personal match history.
3. Optionally add an OpenAI API key for screenshot interpretation.
4. Start League. The companion reconnects automatically and follows lobby, champion-select, in-game, and post-game states.

The Command Center shows the player-facing patch (for example `26.16`) and retains the raw Data Dragon build separately for provenance.

## Live augment workflow

Arena Build Lab uses a provider pipeline rather than coupling the UI to one data source:

- **Overwolf Game Events Provider:** documented Mayhem `augments` and `picked_augment` events flow through the provider bridge into the overlay, owned-augment state, recommendations, and resolver.
- **League local surfaces:** LCU and Live Client Data provide connection state, phase, champion, level, live stats, items, and any augment information present in the payload.
- **Local visual provider:** while a supported match is active, Electron watches only for the stable three-card selection layout, identifies augment and Prismatic item icons against the local catalog, and sends the three choices into the overlay automatically. Frames are not retained unless diagnostics are explicitly enabled.
- **Assisted fallback:** `Ctrl+Shift+A` opens the screenshot picker when a visual match is uncertain. Confirm the detected choice with `1`, `2`, or `3` to push it into the same owned-augment pipeline.
- **Manual fallback:** select the three offers directly when neither event nor image input is available. Local stat comparisons do not require an AI key.

Every source normalizes to the same internal selection IDs. The HUD records which provider supplied a choice, updates item recommendations for the current champion and selected augment set, and re-runs the stat resolver.

The next implementation milestones and release gates live in [ROADMAP.md](ROADMAP.md).

## Features

- Command Center with client status, player-facing patch, warehouse health, recent matches, and trophy previews.
- Always-on-top live overlay with persistent position, adjustable opacity/scale, reconnect handling, and OBS mode.
- Live champion, level, HP, AD, AP, attack speed, items, augment state, and resolver-powered Craze Factor.
- Automatic three-card augment and Prismatic-item recognition with per-choice stat deltas, a highlighted pick, and champion-specific continuation paths.
- Fixed-point stat resolver with convergence/divergence diagnostics and reproducible scenario inputs.
- Extreme Build Browser for health, AD, AP, attack speed, haste, movement speed, crit damage, and on-hit objectives.
- Champion-plus-augment item recommendations derived from the local participant cohort; low samples are labelled rather than replaced with unrelated global items.
- Immutable Match-v5 warehouse, patch/region meta snapshots, personal match history, and transient-stat trophy records.
- Configurable video evidence catalog with timestamped entity links.

## Development

Requirements: Windows, Node.js 24+, and Python 3.14+ for worker development.

```powershell
npm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r workers\requirements.txt
npm run data:sync
npm run dev
```

Useful commands:

```powershell
npm run riot:sync -- --player="Your Riot ID#NA1" --count=20
npm run meta:calculate
npm run find-extreme
npm run audit:lcu -- --duration=60 --interval=5
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run electron:build
```

`npm run electron:build` creates the Windows NSIS installer in `dist/`. Local settings, API keys, captured diagnostics, databases, and private fixtures must remain gitignored.

## Data model

- CommunityDragon/Data Dragon supply patch-aware champions, augments, items, icons, and structured descriptions.
- Match-v5 responses are stored immutably in `riot_matches` and `riot_participants`.
- `participant_augments` projects selections into an indexed query surface.
- `meta_snapshots` stores repeatable local aggregates by source, patch, region, champion, and selection.
- `live_observations` preserves transient peaks that final match payloads may not retain.
- Uncatalogued numeric selections remain intact and display as `Uncatalogued selection (ID: XXX)` until a later catalog refresh resolves them.

## Project boundary

Arena Build Lab is an independent community companion. It reads supported local/provider data, stores analysis locally, presents decision support, and does not inject into the game or automate player input.
