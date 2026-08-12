import Link from "next/link";
import { LiveOverlay } from "@/components/overlay/LiveOverlay";
import { getArenaMeta, getOverlayCatalog } from "@/lib/arena-meta";
import { getChampions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function OverlayPage() {
  return (
    <main className="overlay-page">
      <div className="overlay-topline">
        <Link href="/">Arena Build Lab</Link>
        <span>Read-only local companion</span>
      </div>
      <LiveOverlay champions={getChampions()} entities={getOverlayCatalog()} meta={getArenaMeta()} />
    </main>
  );
}
