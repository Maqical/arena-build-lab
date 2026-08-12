import { type NextRequest } from "next/server";
import { searchCatalog } from "@/lib/queries";
import type { EntityKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const kind: EntityKind = params.get("kind") === "item" ? "item" : "augment";
  return Response.json({
    entities: searchCatalog({
      kind,
      query: params.get("q") ?? "",
      tag: params.get("tag") ?? "",
      limit: Number(params.get("limit") ?? 60),
    }),
  });
}
