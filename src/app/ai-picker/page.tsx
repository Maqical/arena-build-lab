import Link from "next/link";
import { AIPicker } from "@/components/AIPicker";
import { getChampions, getEntityOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function AIPickerPage() {
  return (
    <main className="picker-shell">
      <header className="picker-header">
        <div>
          <span className="eyebrow">Live draft assistant</span>
          <h1>AI Arena Picker</h1>
          <p>Compare all three offers against your exact current build for free, then ask AI for a two-sentence matchup-aware choice.</p>
        </div>
        <Link href="/">Back to Build Lab</Link>
      </header>
      <AIPicker champions={getChampions()} entities={getEntityOptions()} />
    </main>
  );
}
