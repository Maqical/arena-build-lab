import { resolveLiveBuild } from "@/lib/live-build";
import type { LiveResolveRequest } from "@/lib/live-overlay-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json(resolveLiveBuild(await request.json() as LiveResolveRequest));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
