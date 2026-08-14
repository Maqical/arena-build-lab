import { getDatabase } from "@/lib/db";
import { displayPatchVersion } from "@/lib/patch-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const localPatch = String((getDatabase().prepare("SELECT value FROM metadata WHERE key='patch'").get() as { value?: string } | undefined)?.value ?? "");
  try {
    const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Data Dragon returned HTTP ${response.status}.`);
    const versions = await response.json() as unknown;
    const livePatch = Array.isArray(versions) ? String(versions[0] ?? "") : "";
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(livePatch)) throw new Error("Data Dragon returned an invalid patch list.");
    return Response.json({ localPatch, livePatch, localDisplayPatch: displayPatchVersion(localPatch), liveDisplayPatch: displayPatchVersion(livePatch), stale: localPatch !== livePatch, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ localPatch, livePatch: "", localDisplayPatch: displayPatchVersion(localPatch), liveDisplayPatch: "", stale: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Patch check failed." }, { headers: { "Cache-Control": "no-store" } });
  }
}
