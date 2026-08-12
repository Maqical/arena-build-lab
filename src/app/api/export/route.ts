import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportKind = "augment" | "item" | "combos" | "videos";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("kind") ?? "augment";
  if (!["augment", "item", "combos", "videos"].includes(requested)) {
    return Response.json({ error: "kind must be augment, item, combos, or videos" }, { status: 400 });
  }
  const kind = requested as ExportKind;
  const db = getDatabase();
  let rows: Array<Record<string, unknown>>;

  if (kind === "augment" || kind === "item") {
    rows = db.prepare(`
      SELECT numeric_id AS id, name, rarity, description, tooltip, purchasable, price,
        tags_json AS tags, produces_json AS produces, consumes_json AS consumes,
        patch, source_url
      FROM entities WHERE kind = ? ORDER BY name
    `).all(kind) as Array<Record<string, unknown>>;
  } else if (kind === "combos") {
    rows = db.prepare(`
      SELECT title, origin, summary, entity_keys_json AS entity_keys,
        champion_tags_json AS champion_tags, goal_tags_json AS goal_tags,
        score, evidence_url, evidence_note, patch
      FROM combos
      ORDER BY CASE origin WHEN 'curated' THEN 0 WHEN 'video' THEN 1 ELSE 2 END, score DESC
    `).all() as Array<Record<string, unknown>>;
  } else {
    rows = db.prepare(`
      SELECT v.video_id, v.title, v.published_at, v.duration_seconds, v.url,
        v.transcript_status,
        COALESCE(group_concat(DISTINCT e.name), '') AS matched_entities
      FROM videos v
      LEFT JOIN video_mentions vm ON vm.video_id = v.video_id
      LEFT JOIN entities e ON e.entity_key = vm.entity_key
      GROUP BY v.video_id
      ORDER BY v.catalog_position ASC
    `).all() as Array<Record<string, unknown>>;
  }

  const patch = (db.prepare("SELECT value FROM metadata WHERE key='patch'").get() as { value?: string } | undefined)?.value ?? "current";
  return new Response(`\uFEFF${toCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="arena-${kind}-${patch}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
