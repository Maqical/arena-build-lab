# Arena Build Lab

Arena Build Lab is a local-first companion from Frbz.gg, published by Froobs, LLC.

Local-first Arena and ARAM: Mayhem companion with a live overlay, recursive stat-conversion engine, AI-assisted augment picker, personal match history, and an immutable local data warehouse.

## Start

```powershell
npm install
npm run data:sync
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r workers\requirements.txt
npm run youtube:sync
npm run dev
```

Open <http://localhost:3000>.

The live draft picker is at <http://localhost:3000/ai-picker>. Manual three-option comparisons always run locally. To enable screenshot reading and the optional two-sentence AI recommendation, copy `.env.example` to `.env.local`, set `OPENAI_API_KEY`, and optionally change `OPENAI_PICKER_MODEL`.

The live companion is at <http://localhost:3000/overlay>. Open it as a 450x720 browser window on a second monitor. It discovers the running League Client lockfile, follows Arena lobby/champion-select/in-game transitions over the local LCU event stream, and reads current champion stats and items from the local Live Client Data API. The overlay sends detected state into the existing resolver and AI picker; no process injection, memory reading, or automated game input is used. Add `?demo=1` to preview augment selection or `?demo=champ-select` to preview Champion Select without running League.

## Desktop distribution

Run `npm run electron:build` on Windows to produce `dist/Arena-Build-Lab-1.0.0-Setup.exe`. The installer launches the existing Next production server locally, opens the 450x720 frameless overlay, keeps it in the system tray when closed, and offers a startup toggle. Open Settings from the tray to save API keys, adjust opacity/scale, or launch data workers. `Ctrl+Shift+A` is registered at the desktop-shell level: it captures the primary display into the clipboard and invokes the existing screenshot augment picker. Pass `--obs` to the Electron entrypoint for a chroma-green OBS window (`electron electron/main.cjs --obs`).

### Download & install

Download `Arena-Build-Lab-1.0.0-Setup.exe` for Windows, run it, and launch Arena Build Lab from the Start Menu or desktop shortcut. The app keeps its database and settings under the Windows user-data folder, so upgrades do not overwrite personal history. On first launch it initializes the local Arena database and refreshes bundled data in the background.

The desktop release includes the Live Game HUD, recursive Extreme Build Engine, AI/screenshot augment picker, local Riot Match warehouse, local meta aggregation, item assistant, trophy case, and tray-controlled overlay customization. No Python installation or terminal is required for the bundled Riot, CommunityDragon/Data Dragon, and YouTube worker assets.

### Development

Developers can run the stack from a checkout with Node 24+, Python 3.14+, and the virtual environment:

```powershell
npm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r workers\requirements.txt
npm run data:sync
npm run dev
```

Use `npm run build:workers` to compile the Python and bundled Node workers, then `npm run electron:build` to create the Windows installer. `npm test`, `npm run lint`, and `npx tsc --noEmit` are the normal pre-release checks.

The mathematical build table is at <http://localhost:3000/extreme-builds>. It loads `data/extreme_builds.csv` on the server and provides champion/objective/search filters, HP/AD/AP/AS sorting, scenario-aware stats, and copyable build plans. The live Champion Select dashboard is at <http://localhost:3000/champ-select>; it follows the same LCU stream and combines the hovered champion with local extreme builds, curated conversion paths, and synced meta labels.

`data:sync` refreshes patch-aware champion, augment, and Arena item data. `youtube:sync` incrementally catalogs configured channel uploads and retrieves captions for the newest detailed videos. Both commands are safe to rerun.

To ingest your own Arena history from Riot Match-v5, copy `.env.example` to `.env.local`, set `RIOT_API_KEY`, and run:

```powershell
npm run riot:sync -- --player="Your Riot ID#NA1" --count=20
```

The command resolves the Riot ID, requests current queue `1740` and historical queue `1700`, stores raw matches and participants immutably, and checkpoints each cohort member. Re-running it does not duplicate matches. For an explicitly labeled KR Ranked Solo Challenger proxy cohort, use `npm run riot:sync -- --platform=kr --region=asia --cohort=kr-challenger-proxy --seed-challenger=10`. This is a seed population, not an Arena rank. Existing cohorts can also be extended with repeated `--puuid=...` arguments. API keys stay server-side and `.env.local` is ignored by Git.

The checked-in parser fixture is schema-faithful and contains no real player data. After the first successful sync, `--capture-fixture=tests/fixtures/riot_match_real.local.json` can save one redacted real response for local verification; `*.local.json` fixtures are ignored by Git.

## What is included

- Current champion, Arena augment, and map-30 item records in `data/arena.sqlite`.
- Hand-verified conversion chains, exact YouTube-title build leads, and lower-confidence graph-discovered pairs shown as separate evidence classes.
- Champion, build-goal, and text filters; every catalog card can jump directly into matching build paths.
- An executable Stat Lab that chains current structured coefficients for high-value conversions such as mana → health → AD and AP → haste → movement → attack speed. Every result includes its arithmetic trace.
- A local My Runs journal for champion, placement, items, augments, notes, and per-choice personal performance. These rates describe only the user's own saved matches and are never presented as global statistics.
- An immutable Riot Match-v5 warehouse with source region/platform, raw response hashes, participant augment/item snapshots, resumable cohort checkpoints, and rate-limit-aware ingestion.
- A repeatable local meta projection with first-place rate, Top 4 rate, pick rate, region/patch grouping, and a compatibility fallback to the legacy `arena_meta` source.
- A pure fixed-point resolver for recursive stat graphs plus an offline extreme-build search covering 1 Prismatic, 2 Gold, and 1 Silver augment slots.
- A live three-offer draft picker with local stat deltas, current item/augment context, optional screenshot extraction, and a structured OpenAI recommendation with a deterministic no-key fallback.
- A compact live companion overlay with automatic League lockfile discovery, reconnect backoff, Arena phase detection, SSE updates, current-game stats, resolver-powered Craze Factor, live item paths, and a quick visibility toggle.
- Local Live Client peak-stat observations persisted at Arena game end, preserving transient maxima such as HP or AD that may not appear in the end-of-game Match-v5 payload.
- `/history` for personal Riot-ingested games and `/trophies` for the top ten locally recorded HP, AD, and AP peaks.
- A sortable Extreme Build Browser that exposes the 658k-HP Sion benchmark and every row in `data/extreme_builds.csv`.
- A Champion Select assistant with automatic hover/lock detection, extreme targets, augment/item anchors, and clearly labeled role-plus-meta duo candidates.
- A clipboard-image picker in the overlay: take a snip with `Win+Shift+S`, focus the overlay, then press `Ctrl+Shift+A`, paste normally, or click **Paste augment snip**.
- Searchable video titles, descriptions, captions, exact entity mentions, champion links, and timestamped evidence.
- A crash-safe incremental YouTube worker. Network requests run concurrently, while SQLite writes remain serialized.
- Responsive local UI plus JSON endpoints at `/api/catalog`, `/api/combos`, `/api/videos`, and `/api/personal-runs`.
- One-click full CSV exports for augments, items, recommendations, and the video evidence catalog.

## Refresh workflows

```powershell
# Refresh current Riot/CommunityDragon data and rebuild all mechanic paths
npm run data:sync

# Refresh champion win/pick/tier and augment pick/tier labels used by the overlay
npm run meta:sync

# Aggregate immutable Riot Arena matches into local meta snapshots
npm run meta:calculate

# Enrich 20 more incomplete uploads with descriptions and English captions
npm run youtube:sync

# Rebuild exact title/description links and video-derived combo cards without network calls
npm run youtube:link

# Deep channel pass (safe to interrupt and rerun)
.venv\Scripts\python.exe workers\youtube_catalog.py --details-limit 1000 --transcripts --workers 4
```

## Live client boundary

`/api/lcu/status` is a server-sent event stream; `/api/lcu/status?once=1` returns one diagnostic snapshot. Lockfile credentials never leave the backend response boundary. Auto-detection of the exact three offered augments is conservative: the monitor accepts only an explicitly named three-option augment payload from a local client event and will never guess from unrelated choices. Riot's currently published LCU and Live Client schemas do not document the Arena offer payload, so the overlay reports `Offer feed unavailable` when the running client does not emit it. Manual/screenshot picking remains available in that case. Selected items and live combat stats continue to update automatically.

The LCU surface is locally available but unsupported for third-party applications. Before distributing a public companion, register the product through Riot's developer portal and revalidate the local endpoints after League patches. If lockfile discovery cannot locate a custom install, set `LEAGUE_LOCKFILE_PATH` in `.env.local`.

The desktop shell registers `Ctrl+Shift+A` globally and captures the primary display only after that explicit user action. In a normal browser, paste a user-captured image or use the adjacent **Image** button instead. Screenshot contents go to the configured OpenAI vision endpoint only after one of those user actions; live stats and manual choices remain local.

The copied extreme-build text is a readable loadout plan for notes/chat. League currently has no Arena-augment import schema, so the app does not claim those plans are native client item-set imports.

Age-restricted videos are skipped unless a local browser cookie source is supplied with `--cookies-from-browser chrome` (or another yt-dlp-supported browser). No cookies are stored in the Arena database.

## Evidence model

- **Curated:** manually reviewed conversion chain, optionally tied to a specific video.
- **Video-derived:** two or more current entity names matched exactly in a video title. Historical balance values may differ.
- **Mechanically discovered:** current tooltip tags connect one entity's produced stat to another entity's consumed stat. These are leads, not claims of a proven run.

## Local personal data

`My runs` writes only to the ignored local file `data/arena.sqlite`. Static data refreshes preserve recorded run snapshots, even if an item or augment later changes or leaves the catalog. The personal dashboard reports sample size beside first-place rate, top-half rate, and average placement so small samples remain visible.

The first Stat Lab formula set is intentionally narrower than the discovery graph. A formula is executable only when its operation and coefficient can be traced to structured current-patch data or explicit item text; regex-discovered relationships remain recommendations until they receive an executable definition and test.

## Extreme build engine

For the focused Sion, Cho'Gath, Ezreal, and Shyvana sweep requested by the project roadmap, run:

```powershell
npm run find-extreme
```

This writes the top 10 builds for each of Max HP, Max AD, Max AP, and Max AS (40 rows total) to `data/extreme_builds.csv`. The current finite benchmark reproduces a 658k-HP Sion while still marking Sion's true uncapped passive ceiling as theoretical/unbounded.

Run the current-patch theoretical benchmark and write its top-100 review CSV:

```powershell
npm run extremes
```

This runs `scripts/generate-extreme-builds.ts`, stores ranked results in the local `extreme_builds` table, and writes `data/extreme-builds-top-100.csv`. You can restrict generation to named champions:

```powershell
npm run extremes:build -- Sion Chogath
npm run extremes:export -- --objective=maxHealth --output=data/my-health-builds.csv
```

The default benchmark evaluates Sion, Cho'Gath, Swain, Shyvana, Senna, and Thresh at level 18. It exhaustively combines the 26 currently executable stat-changing augments under the `1 Prismatic + 2 Gold + 1 Silver` constraint. Non-stat augments are omitted as mathematically equivalent no-op fillers for these objectives. Overlord's Bloodmail is included as a fixed conversion item, with Retribution evaluated at its stated maximum. Scenario-dependent inputs are recorded with every row: 48,000 pre-quest Heartsteel stacks, 24 takedowns, 500 Cursed Power, 100 Phenomenal Evil procs, 13,200 Sion small-unit Soul Furnace stacks, and 50 Cho'Gath champion Feast stacks.

Those inputs make runs reproducible; they are not claims about an ordinary match. Sion and Cho'Gath health-derived objectives are also marked `theoreticalUnbounded`, because without a time/stack boundary no finite absolute maximum exists. The resolver similarly reports non-contracting conversion cycles as divergent instead of inventing a final number.

Query stored results from the app:

```text
GET /api/extreme-builds?champion=Sion&objective=maxHealth&limit=10
```

Valid objectives are `maxHealth`, `totalAttackDamage`, `abilityPower`, `abilityHaste`, `moveSpeed`, `attackSpeed`, `critDamagePercent`, and `onHitPhysicalDamage`.

Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:ui` for verification. With the local server running, `npm run audit:recommendations` exhaustively checks every champion and every owned item/augment for ownership leaks, exact-champion leaks, and duplicate recommendations. The UI test uses an installed Microsoft Edge build in headless mode.

Arena Build Lab is an independent community tool. Use it as a reference and verify current game behavior in-client.
