import { type NextRequest } from "next/server";
import { searchVideoStatClaims } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return Response.json({
    claims: searchVideoStatClaims({
      champion: params.get("champion") ?? "",
      statKey: params.get("stat") ?? "",
      query: params.get("q") ?? "",
      limit: Number(params.get("limit") ?? 60),
    }),
  });
}
