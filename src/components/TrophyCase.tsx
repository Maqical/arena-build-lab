"use client";

import Image from "next/image";
import Link from "next/link";
import type { Trophy } from "@/lib/history";

function number(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function TrophyCase({ trophies }: { trophies: Trophy[] }) {
  return <main className="trophy-shell">
    <header className="collection-header"><div><span className="eyebrow">Local Live Client observations</span><h1>Trophy Case</h1><p>The biggest transient Arena numbers recorded by your local companion. These are observed peaks, not theoretical resolver projections.</p></div><nav><Link href="/history">Match history</Link><Link href="/extreme-builds">Extreme builds</Link><Link href="/overlay">Overlay</Link></nav></header>
    {trophies.length === 0 ? <div className="collection-empty"><strong>No trophies yet</strong><p>Play an Arena game while the overlay is running. Peaks are saved when the game leaves the in-progress state.</p></div> : <section className="trophy-grid">{trophies.map((trophy, index) => <article className="trophy-card" key={`${trophy.id}:${trophy.stat}`}><div className="trophy-rank">#{index + 1}</div>{trophy.championIconUrl ? <Image src={trophy.championIconUrl} alt="" width={54} height={54} unoptimized /> : <div className="history-placeholder">?</div>}<div className="trophy-copy"><span>{trophy.stat} record · {new Date(trophy.endedAt).toLocaleDateString()}</span><strong>{number(trophy.value)} {trophy.stat} {trophy.championName}</strong><div>{trophy.augments.length ? trophy.augments.map((augment) => <em key={augment.key}>{augment.name}</em>) : <em>Augment names unavailable</em>}</div></div></article>)}</section>}
  </main>;
}
