import { analyzeLobbyMembers } from "@/lib/lobby-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { members?: Array<{ puuid?: string; gameName?: string; tagLine?: string; rank?: string }> };
  const members = (body.members ?? []).slice(0, 16).map((member) => ({ puuid: String(member.puuid ?? ""), gameName: String(member.gameName ?? "Arena player"), tagLine: String(member.tagLine ?? ""), rank: String(member.rank ?? "Unranked") }));
  return Response.json({ members: analyzeLobbyMembers(members) }, { headers: { "Cache-Control": "no-store" } });
}
