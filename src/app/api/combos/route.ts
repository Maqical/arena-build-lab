import { type NextRequest } from "next/server";
import { searchCombos } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return Response.json({
    combos: searchCombos({
      query: params.get("q") ?? "",
      goal: params.get("goal") ?? "",
      champion: params.get("champion") ?? "",
      ownedEntityKey: params.get("owned") ?? "",
      curatedOnly: params.get("curated") === "true",
      limit: Number(params.get("limit") ?? 30),
    }),
  });
}
