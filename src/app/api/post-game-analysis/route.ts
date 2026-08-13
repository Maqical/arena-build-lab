import { getPostGameAnalysis } from "@/lib/post-game-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const champion = new URL(request.url).searchParams.get("champion") ?? "";
  return Response.json({ analysis: getPostGameAnalysis(champion) }, { headers: { "Cache-Control": "no-store" } });
}
