import { getChampSelectRecommendation } from "@/lib/champ-select";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const champion = new URL(request.url).searchParams.get("champion")?.trim() ?? "";
  if (!champion) return Response.json({ error: "Champion is required." }, { status: 400 });
  const recommendation = getChampSelectRecommendation(champion);
  if (!recommendation) return Response.json({ error: `Unknown champion: ${champion}` }, { status: 404 });
  return Response.json(recommendation, { headers: { "Cache-Control": "no-store" } });
}
