import { getGameStateMonitor } from "@/lib/lcu/GameStateMonitor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { kind?: unknown; offered?: unknown; picked?: unknown };
    const kind = body.kind === "item" ? "item" : "augment";
    const offered = Array.isArray(body.offered) ? body.offered.map(String) : [];
    const picked = typeof body.picked === "string" ? body.picked : "";
    const monitor = getGameStateMonitor();
    const offeredAccepted = offered.length === 3
      ? kind === "item" ? monitor.ingestProviderItems(offered, "vision://items") : monitor.ingestProviderOffers(offered, "vision://augments")
      : false;
    const pickedAccepted = picked ? kind === "item" ? monitor.confirmItemSelection(picked) : monitor.confirmSelection(picked) : false;
    if (!offeredAccepted && !pickedAccepted) return Response.json({ error: "No valid local visual selection event was accepted." }, { status: 409 });
    return Response.json({ ok: true, offered: offeredAccepted ? offered : [], picked: pickedAccepted ? picked : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
