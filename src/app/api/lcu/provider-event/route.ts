import { parseAugmentProviderUpdate } from "@/lib/augment-provider";
import { getGameStateMonitor } from "@/lib/lcu/GameStateMonitor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const update = parseAugmentProviderUpdate(await request.json());
    const monitor = getGameStateMonitor();
    const offeredAccepted = update.offered.length === 3 ? monitor.ingestProviderOffers(update.offered, "overwolf://augments") : false;
    const pickedAccepted = update.picked ? monitor.confirmSelection(update.picked) : false;
    if (!offeredAccepted && !pickedAccepted) return Response.json({ error: "No usable augment provider update was found or no supported match is active." }, { status: 409 });
    return Response.json({ ok: true, offered: update.offered, picked: update.picked });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
