# Arena Build Lab

Local-first League of Legends Arena reference, evidence catalog, and build-combination explorer. It combines current CommunityDragon/Data Dragon records with an incremental King Nidhogg YouTube catalog and an auditable stat producer/consumer graph.

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

`data:sync` refreshes patch-aware champion, augment, and Arena item data. `youtube:sync` incrementally catalogs King Nidhogg uploads and retrieves captions for the newest detailed videos. Both commands are safe to rerun.

## What is included

- Current champion, Arena augment, and map-30 item records in `data/arena.sqlite`.
- Hand-verified conversion chains, exact YouTube-title build leads, and lower-confidence graph-discovered pairs shown as separate evidence classes.
- Champion, build-goal, and text filters; every catalog card can jump directly into matching build paths.
- Searchable video titles, descriptions, captions, exact entity mentions, champion links, and timestamped evidence.
- A crash-safe incremental YouTube worker. Network requests run concurrently, while SQLite writes remain serialized.
- Responsive local UI plus read-only JSON endpoints at `/api/catalog`, `/api/combos`, and `/api/videos`.
- One-click full CSV exports for augments, items, recommendations, and the video evidence catalog.

## Refresh workflows

```powershell
# Refresh current Riot/CommunityDragon data and rebuild all mechanic paths
npm run data:sync

# Enrich 20 more incomplete uploads with descriptions and English captions
npm run youtube:sync

# Rebuild exact title/description links and video-derived combo cards without network calls
npm run youtube:link

# Deep channel pass (safe to interrupt and rerun)
.venv\Scripts\python.exe workers\youtube_catalog.py --details-limit 1000 --transcripts --workers 4
```

Age-restricted videos are skipped unless a local browser cookie source is supplied with `--cookies-from-browser chrome` (or another yt-dlp-supported browser). No cookies are stored in the Arena database.

## Evidence model

- **Curated:** manually reviewed conversion chain, optionally tied to a specific video.
- **Video-derived:** two or more current entity names matched exactly in a video title. Historical balance values may differ.
- **Mechanically discovered:** current tooltip tags connect one entity's produced stat to another entity's consumed stat. These are leads, not claims of a proven run.

Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:ui` for verification. With the local server running, `npm run audit:recommendations` exhaustively checks every champion and every owned item/augment for ownership leaks, exact-champion leaks, and duplicate recommendations. The UI test uses an installed Microsoft Edge build in headless mode.

Arena Build Lab is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
