import { getBuildsForAugments } from "@/lib/augment-builds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const championId = Number(params.get("championId"));
  const augmentIds = (params.get("augmentIds") ?? "").split(",").map(Number).filter(Number.isInteger);
  if (!Number.isInteger(championId) || championId <= 0) return Response.json({ error: "A valid championId is required." }, { status: 400 });
  if (augmentIds.length === 0) return Response.json({ error: "At least one augmentId is required." }, { status: 400 });
  return Response.json(getBuildsForAugments(championId, augmentIds), { headers: { "Cache-Control": "no-store" } });
}
