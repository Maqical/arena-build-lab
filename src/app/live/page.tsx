import { LiveOverlay } from "@/components/overlay/LiveOverlay";
import { getArenaMeta, getOverlayCatalog } from "@/lib/arena-meta";
import { getChampions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function LivePage() {
  return <main className="live-companion-page"><header><span className="eyebrow">Full-size companion</span><h1>Live game</h1><p>This view mirrors the compact overlay with room for player context, recommendations, and diagnostics.</p></header><LiveOverlay champions={getChampions()} entities={getOverlayCatalog()} meta={getArenaMeta()} /></main>;
}
