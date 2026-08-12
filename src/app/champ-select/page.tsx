import Link from "next/link";
import { ChampSelectAssistant } from "@/components/overlay/ChampSelectAssistant";
import { getChampions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ChampSelectPage() {
  return <main className="champ-select-page">
    <header><div><span className="eyebrow">Read-only LCU companion</span><h1>Arena Champion Select</h1><p>Hover or lock a champion to load extreme targets, conversion anchors, and role-fit duo candidates from the local database.</p></div><nav><Link href="/extreme-builds">Extreme builds</Link><Link href="/overlay">Compact overlay</Link><Link href="/">Build Lab</Link></nav></header>
    <ChampSelectAssistant champions={getChampions()} />
  </main>;
}
