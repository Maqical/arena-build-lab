import { getGameStateMonitor } from "@/lib/lcu/GameStateMonitor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { entityKey?: unknown };
    const entityKey = typeof body.entityKey === "string" ? body.entityKey.trim() : "";
    if (!entityKey) return Response.json({ error: "A selection entity key is required." }, { status: 400 });
    const accepted = getGameStateMonitor().confirmSelection(entityKey);
    if (!accepted) return Response.json({ error: "No supported Arena or ARAM: Mayhem match is active." }, { status: 409 });
    return Response.json({ ok: true, entityKey });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
