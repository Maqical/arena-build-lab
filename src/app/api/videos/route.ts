import { type NextRequest } from "next/server";
import { searchVideos } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return Response.json({
    videos: searchVideos({
      query: params.get("q") ?? "",
      champion: params.get("champion") ?? "",
      limit: Number(params.get("limit") ?? 30),
    }),
  });
}
