import { type NextRequest } from "next/server";
import { EXTREME_OBJECTIVES } from "@/engine/extreme-finder";
import { queryExtremeBuilds } from "@/lib/extreme-builds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const objective = params.get("objective") ?? "";
  if (objective && !EXTREME_OBJECTIVES.includes(objective as typeof EXTREME_OBJECTIVES[number])) {
    return Response.json({ error: `Unknown objective. Use one of: ${EXTREME_OBJECTIVES.join(", ")}.` }, { status: 400 });
  }
  const rawLimit = Number(params.get("limit") ?? 25);
  if (!Number.isFinite(rawLimit)) return Response.json({ error: "Limit must be numeric." }, { status: 400 });
  const builds = queryExtremeBuilds({
    champion: params.get("champion") ?? "",
    objective,
    scenario: params.get("scenario") ?? "",
    limit: rawLimit,
  });
  return Response.json({
    builds,
    count: builds.length,
    objectives: EXTREME_OBJECTIVES,
    note: "Finite scores use the recorded benchmark scenario. theoreticalUnbounded marks objectives with no mathematical maximum.",
  });
}
