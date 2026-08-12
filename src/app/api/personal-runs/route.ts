import { type NextRequest } from "next/server";
import { createPersonalRun, getPersonalRuns, getPersonalStats, PersonalRunValidationError } from "@/lib/personal-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const rawChampion = request.nextUrl.searchParams.get("championId");
  const championId = rawChampion ? Number(rawChampion) : undefined;
  if (championId !== undefined && (!Number.isInteger(championId) || championId <= 0)) {
    return Response.json({ error: "Champion id is invalid." }, { status: 400 });
  }
  return Response.json({
    runs: getPersonalRuns(100, championId),
    stats: getPersonalStats(championId),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PersonalRunValidationError("Request body must be an object.");
    return Response.json({ run: createPersonalRun(body as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    if (error instanceof PersonalRunValidationError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    throw error;
  }
}
