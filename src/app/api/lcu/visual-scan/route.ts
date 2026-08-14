import { evaluateAIPicker } from "@/lib/ai-picker";
import { getDatabase } from "@/lib/db";
import { getGameStateMonitor } from "@/lib/lcu/GameStateMonitor";

export const runtime = "nodejs";

function normalized(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { screenshotDataUrl?: string };
    if (!body.screenshotDataUrl) return Response.json({ error: "A screenshot is required." }, { status: 400 });
    const monitor = getGameStateMonitor();
    const snapshot = monitor.snapshot();
    if (!snapshot.supportsAugments || snapshot.phase === "disconnected") {
      return Response.json({ error: "No supported live match is active." }, { status: 409 });
    }
    const db = getDatabase();
    const champion = db.prepare(`
      SELECT id, champion_key, name FROM champions
      WHERE id = ? OR lower(champion_key) = lower(?) OR lower(name) = lower(?)
      LIMIT 1
    `).get(snapshot.champion.id, snapshot.champion.name, snapshot.champion.name) as { id: number; champion_key: string; name: string } | undefined;
    if (!champion) return Response.json({ error: `Could not resolve live champion ${snapshot.champion.name || snapshot.champion.id || "unknown"}.` }, { status: 409 });

    const aliases = new Map<string, string>();
    const rows = db.prepare("SELECT entity_key, numeric_id, api_name, name, kind FROM entities").all() as Array<{ entity_key: string; numeric_id: number; api_name: string; name: string; kind: string }>;
    for (const row of rows) {
      for (const alias of [row.entity_key, String(row.numeric_id), `${row.kind}:${row.numeric_id}`, row.api_name, row.name]) aliases.set(normalized(alias), row.entity_key);
    }
    const currentEntityKeys = [...new Set(snapshot.currentEntityRefs.map((reference) => aliases.get(normalized(reference))).filter((key): key is string => Boolean(key)))];
    const result = await evaluateAIPicker({
      championId: champion.id,
      level: snapshot.champion.level,
      mode: snapshot.mode ?? "arena",
      currentEntityKeys,
      screenshotDataUrl: body.screenshotDataUrl,
      opponent: snapshot.mode === "aram_mayhem" ? "current ARAM: Mayhem match" : "current Arena match",
      useAI: false,
    });
    const offered = result.options.map((option) => option.entity.entityKey);
    if (!monitor.ingestProviderOffers(offered, "vision://local")) {
      return Response.json({ error: "The three detected selections were not accepted by the live monitor." }, { status: 409 });
    }
    return Response.json({ ok: true, offered, names: result.options.map((option) => option.entity.name), recommendation: result.recommendation });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
