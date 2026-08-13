from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sqlite3
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from yt_dlp import YoutubeDL


DEFAULT_CHANNEL = os.environ.get("ARENA_VIDEO_CHANNEL", "")
CHANNEL_ID = os.environ.get("ARENA_VIDEO_CHANNEL_ID", "")

VIDEO_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  transcript_status TEXT NOT NULL DEFAULT 'not_requested',
  transcript_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  catalog_position INTEGER NOT NULL DEFAULT 0,
  scraped_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_published_idx ON videos(published_at DESC);
CREATE TABLE IF NOT EXISTS video_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  entity_key TEXT NOT NULL REFERENCES entities(entity_key) ON DELETE CASCADE,
  source TEXT NOT NULL,
  timestamp_seconds REAL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  UNIQUE(video_id, entity_key, source, timestamp_seconds)
);
CREATE INDEX IF NOT EXISTS video_mentions_video_idx ON video_mentions(video_id);
CREATE INDEX IF NOT EXISTS video_mentions_entity_idx ON video_mentions(entity_key);
CREATE TABLE IF NOT EXISTS video_champions (
  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  champion_id INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY(video_id, champion_id, source)
);
CREATE INDEX IF NOT EXISTS video_champions_video_idx ON video_champions(video_id);
CREATE INDEX IF NOT EXISTS video_champions_champion_idx ON video_champions(champion_id);
"""

ALIASES = {
    "vuln": "Vulnerability",
    "blossoming dawn": "Sword of Blossoming Dawn",
    "shard blade": "Shardblade",
    "hamstringer": "Hamstringer",
    "steel your heart": "Quest: Steel Your Heart",
    "heart steel": "Heartsteel",
    "overlords": "Overlord's Bloodmail",
    "demon kings": "Demon King's Crown",
    "wooglets": "Quest: Wooglet's Witchcap",
}


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Incrementally catalog and caption Arena videos from a configured channel.")
    parser.add_argument("--channel", default=DEFAULT_CHANNEL)
    parser.add_argument("--database", default=os.environ.get("ARENA_DB_PATH", "data/arena.sqlite"))
    parser.add_argument("--limit", type=int, default=0, help="Limit the flat channel catalog; 0 means all uploads.")
    parser.add_argument("--details-limit", type=int, default=20, help="Fetch full descriptions for this many newest incomplete uploads.")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent YouTube detail/caption requests; database writes remain serialized.")
    parser.add_argument("--transcripts", action="store_true", help="Retrieve an English caption track during detail passes.")
    parser.add_argument("--cookies-from-browser", default="", help="Optional yt-dlp browser cookie source, such as chrome or firefox.")
    parser.add_argument("--link-only", action="store_true", help="Rebuild entity/champion links from rows already in SQLite without calling YouTube.")
    return parser.parse_args()


def ydl_options(args: argparse.Namespace, *, flat: bool) -> dict[str, Any]:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "skip_download": True,
        "extract_flat": "in_playlist" if flat else False,
    }
    if args.cookies_from_browser:
        options["cookiesfrombrowser"] = (args.cookies_from_browser,)
    if flat and args.limit > 0:
        options["playlistend"] = args.limit
    return options


def iso_date(info: dict[str, Any]) -> str:
    timestamp = info.get("timestamp") or info.get("release_timestamp")
    if timestamp:
        return dt.datetime.fromtimestamp(float(timestamp), tz=dt.timezone.utc).isoformat()
    upload_date = str(info.get("upload_date") or "")
    if re.fullmatch(r"\d{8}", upload_date):
        return dt.datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=dt.timezone.utc).isoformat()
    return str(info.get("release_date") or "")


def caption_tracks(info: dict[str, Any]) -> list[dict[str, Any]]:
    sources = [info.get("subtitles") or {}, info.get("automatic_captions") or {}]
    for source in sources:
        for language in ("en", "en-US", "en-orig"):
            tracks = source.get(language)
            if tracks:
                return sorted(tracks, key=lambda track: 0 if track.get("ext") == "json3" else 1)
        for language, tracks in source.items():
            if str(language).startswith("en") and tracks:
                return sorted(tracks, key=lambda track: 0 if track.get("ext") == "json3" else 1)
    return []


def request_text(url: str, headers: dict[str, str]) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": headers.get("User-Agent", "Mozilla/5.0")})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_json3(payload: str) -> tuple[str, list[tuple[float, str]]]:
    data = json.loads(payload)
    segments: list[tuple[float, str]] = []
    for event in data.get("events", []):
        pieces = event.get("segs") or []
        line = "".join(str(piece.get("utf8") or "") for piece in pieces).replace("\n", " ").strip()
        if line:
            segments.append((float(event.get("tStartMs") or 0) / 1000.0, line))
    return " ".join(line for _, line in segments), segments


def parse_vtt(payload: str) -> tuple[str, list[tuple[float, str]]]:
    lines: list[str] = []
    for line in payload.splitlines():
        stripped = re.sub(r"<[^>]+>", "", line).strip()
        if not stripped or stripped == "WEBVTT" or "-->" in stripped or stripped.isdigit():
            continue
        if not lines or stripped != lines[-1]:
            lines.append(html.unescape(stripped))
    return " ".join(lines), [(0.0, line) for line in lines]


def fetch_caption(info: dict[str, Any]) -> tuple[str, list[tuple[float, str]], str]:
    tracks = caption_tracks(info)
    if not tracks:
        return "", [], "unavailable"
    headers = info.get("http_headers") or {}
    for track in tracks:
        try:
            payload = request_text(str(track.get("url") or ""), headers)
            if not payload.strip():
                continue
            if payload.lstrip().startswith("{"):
                transcript, segments = parse_json3(payload)
            else:
                transcript, segments = parse_vtt(payload)
            if transcript:
                return transcript, segments, "captions_fetched"
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return "", [], "caption_fetch_failed"


def fetch_video_detail(video_id: str, args: argparse.Namespace) -> tuple[str, dict[str, Any] | None, str, list[tuple[float, str]], str]:
    try:
        with YoutubeDL(ydl_options(args, flat=False)) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    except Exception as error:  # yt-dlp uses several extractor-specific exception types.
        print(f"detail fetch failed for {video_id}: {error}", file=sys.stderr)
        return video_id, None, "", [], "unavailable"
    if not info:
        return video_id, None, "", [], "unavailable"
    if not args.transcripts:
        return video_id, info, "", [], "not_requested"
    transcript, segments, status = fetch_caption(info)
    return video_id, info, transcript, segments, status


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def contains_phrase(haystack: str, needle: str) -> bool:
    return bool(re.search(rf"(?:^|\s){re.escape(needle)}(?:$|\s)", normalized(haystack)))


def entity_aliases(connection: sqlite3.Connection) -> list[tuple[str, str, str]]:
    rows = connection.execute("SELECT entity_key, name FROM entities").fetchall()
    aliases: list[tuple[str, str, str]] = []
    by_name = {str(name).lower(): str(entity_key) for entity_key, name in rows}
    for entity_key, name in rows:
        needle = normalized(str(name))
        if len(needle) >= 5:
            aliases.append((str(entity_key), str(name), needle))
    for alias, canonical in ALIASES.items():
        key = by_name.get(canonical.lower())
        if key:
            aliases.append((key, canonical, normalized(alias)))
    return aliases


def link_mentions(
    connection: sqlite3.Connection,
    video_id: str,
    title: str,
    description: str,
    transcript_segments: list[tuple[float, str]],
) -> int:
    connection.execute("DELETE FROM video_mentions WHERE video_id = ? AND source IN ('title', 'description')", (video_id,))
    if transcript_segments:
        connection.execute("DELETE FROM video_mentions WHERE video_id = ? AND source = 'transcript'", (video_id,))
    sources = [("title", None, title, 0.98), ("description", None, description, 0.93)]
    sources.extend(("transcript", seconds, line, 0.82) for seconds, line in transcript_segments)
    inserted: set[tuple[str, str]] = set()
    count = 0
    for entity_key, _name, needle in entity_aliases(connection):
        for source, timestamp, evidence, confidence in sources:
            if not evidence or not contains_phrase(evidence, needle):
                continue
            dedupe = (entity_key, source)
            if dedupe in inserted:
                continue
            connection.execute(
                """
                INSERT OR IGNORE INTO video_mentions(video_id, entity_key, source, timestamp_seconds, evidence_text, confidence)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (video_id, entity_key, source, timestamp, evidence[:1000], confidence),
            )
            inserted.add(dedupe)
            count += 1
    return count


def link_champions(
    connection: sqlite3.Connection,
    video_id: str,
    title: str,
    description: str,
) -> int:
    connection.execute("DELETE FROM video_champions WHERE video_id = ?", (video_id,))
    sources = [("title", title, 0.99), ("description", description, 0.92)]
    count = 0
    for champion_id, champion_name in connection.execute("SELECT id, name FROM champions"):
        needle = normalized(str(champion_name))
        for source, evidence, confidence in sources:
            if evidence and contains_phrase(evidence, needle):
                connection.execute(
                    """
                    INSERT OR IGNORE INTO video_champions(video_id, champion_id, source, evidence_text, confidence)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (video_id, champion_id, source, evidence[:1000], confidence),
                )
                count += 1
    return count


def upsert_video(
    connection: sqlite3.Connection,
    info: dict[str, Any],
    *,
    detailed: bool = False,
    catalog_position: int = 0,
) -> str:
    video_id = str(info.get("id") or "")
    if not video_id:
        return ""
    url = str(info.get("webpage_url") or info.get("url") or f"https://www.youtube.com/watch?v={video_id}")
    if not url.startswith("http"):
        url = f"https://www.youtube.com/watch?v={video_id}"
    title = str(info.get("title") or "Untitled upload")
    description = str(info.get("description") or "")
    thumbnail = str(info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
    now = dt.datetime.now(tz=dt.timezone.utc).isoformat()
    metadata = {
        "channel": info.get("channel"),
        "channel_id": info.get("channel_id"),
        "availability": info.get("availability"),
        "live_status": info.get("live_status"),
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "tags": info.get("tags") or [],
        "detailed": detailed,
    }
    connection.execute(
        """
        INSERT INTO videos(
          video_id, channel_id, title, description, published_at, duration_seconds,
          url, thumbnail_url, metadata_json, catalog_position, scraped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          title=excluded.title,
          description=CASE WHEN excluded.description <> '' THEN excluded.description ELSE videos.description END,
          published_at=CASE WHEN excluded.published_at <> '' THEN excluded.published_at ELSE videos.published_at END,
          duration_seconds=COALESCE(excluded.duration_seconds, videos.duration_seconds),
          url=excluded.url,
          thumbnail_url=excluded.thumbnail_url,
          metadata_json=CASE WHEN excluded.description <> '' THEN excluded.metadata_json ELSE videos.metadata_json END,
          catalog_position=CASE WHEN excluded.catalog_position > 0 THEN excluded.catalog_position ELSE videos.catalog_position END,
          scraped_at=excluded.scraped_at
        """,
        (
            video_id,
            str(info.get("channel_id") or CHANNEL_ID),
            title,
            description,
            iso_date(info),
            info.get("duration"),
            url,
            thumbnail,
            json.dumps(metadata, ensure_ascii=False),
            catalog_position,
            now,
        ),
    )
    return video_id


def main() -> int:
    args = arguments()
    database_path = Path(args.database).resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.executescript(VIDEO_SCHEMA)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 10000")
    columns = {row[1] for row in connection.execute("PRAGMA table_info(videos)")}
    if "catalog_position" not in columns:
        connection.execute("ALTER TABLE videos ADD COLUMN catalog_position INTEGER NOT NULL DEFAULT 0")

    entries: list[dict[str, Any]] = []
    if not args.link_only:
        with YoutubeDL(ydl_options(args, flat=True)) as ydl:
            channel = ydl.extract_info(args.channel, download=False)
        entries = [entry for entry in (channel or {}).get("entries", []) if entry and entry.get("id")]
        for position, entry in enumerate(entries, start=1):
            video_id = upsert_video(connection, entry, catalog_position=position)
            if video_id:
                current = connection.execute(
                    "SELECT title, description FROM videos WHERE video_id = ?", (video_id,)
                ).fetchone()
                if current:
                    # Keep each flat-catalog title and its evidence links in the same
                    # transaction so an interrupted refresh cannot leave stale matches.
                    link_mentions(connection, video_id, str(current[0]), str(current[1]), [])
                    link_champions(connection, video_id, str(current[0]), str(current[1]))
            if position % 50 == 0:
                connection.commit()
        connection.commit()

    incomplete = [
        str(row[0])
        for row in connection.execute(
            """
            SELECT video_id FROM videos
            WHERE transcript_status <> 'unavailable'
              AND (description = '' OR transcript_status IN ('not_requested', 'caption_fetch_failed'))
            ORDER BY CASE WHEN lower(title) LIKE '%arena%' THEN 0 ELSE 1 END, catalog_position ASC
            LIMIT ?
            """,
            (max(args.details_limit, 0),),
        )
    ]

    detailed = 0
    captions = 0
    mentions = 0
    champion_links = 0
    if incomplete and not args.link_only:
        available_ids = {str(entry.get("id")) for entry in entries}
        video_ids = [video_id for video_id in incomplete if video_id in available_ids]
        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
            futures = [executor.submit(fetch_video_detail, video_id, args) for video_id in video_ids]
            for future in as_completed(futures):
                video_id, info, transcript, segments, status = future.result()
                if not info:
                    connection.execute(
                        "UPDATE videos SET transcript_status = 'detail_fetch_failed' WHERE video_id = ?",
                        (video_id,),
                    )
                    connection.commit()
                    continue
                upsert_video(connection, info, detailed=True)
                if args.transcripts:
                    connection.execute(
                        "UPDATE videos SET transcript_status = ?, transcript_text = ? WHERE video_id = ?",
                        (status, transcript, video_id),
                    )
                    if transcript:
                        captions += 1
                mentions += link_mentions(
                    connection,
                    video_id,
                    str(info.get("title") or ""),
                    str(info.get("description") or ""),
                    segments,
                )
                champion_links += link_champions(
                    connection,
                    video_id,
                    str(info.get("title") or ""),
                    str(info.get("description") or ""),
                )
                detailed += 1
                connection.commit()

    # Link title/description mentions for every flat-catalog video, including older uploads.
    for video_id, title, description in connection.execute("SELECT video_id, title, description FROM videos"):
        mentions += link_mentions(connection, str(video_id), str(title), str(description), [])
        champion_links += link_champions(connection, str(video_id), str(title), str(description))
    connection.commit()

    print(json.dumps({
        "cataloged": len(entries) if not args.link_only else connection.execute("SELECT COUNT(*) FROM videos").fetchone()[0],
        "detailed": detailed,
        "captions_fetched": captions,
        "mentions_linked": mentions,
        "champion_links": champion_links,
        "database": str(database_path),
    }, indent=2))
    connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
