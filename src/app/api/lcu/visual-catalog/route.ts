import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDatabase();
  const rows = db.prepare("SELECT entity_key, kind, name, icon_url, raw_json FROM entities WHERE icon_url<>'' AND (kind='augment' OR (kind='item' AND rarity='prismatic' AND purchasable=1)) ORDER BY kind,entity_key").all() as Array<{ entity_key: string; kind: "augment" | "item"; name: string; icon_url: string; raw_json: string }>;
  const entities = rows.map((row) => {
    let iconLarge = "";
    try { iconLarge = String((JSON.parse(row.raw_json) as { iconLarge?: string }).iconLarge ?? ""); } catch { /* The small icon remains a valid fallback. */ }
    const iconUrl = row.kind === "augment" && iconLarge
      ? `https://raw.communitydragon.org/latest/game/${iconLarge.toLowerCase()}`
      : row.kind === "augment" ? row.icon_url.replace(/_small\.png(?:\?.*)?$/i, "_large.png") : row.icon_url;
    return { entityKey: row.entity_key, kind: row.kind, name: row.name, iconUrl };
  });
  return Response.json({ entities }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
