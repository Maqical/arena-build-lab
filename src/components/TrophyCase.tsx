"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Trophy } from "@/lib/history";

const STATS = ["All", "HP", "AD", "AP", "AS", "Armor", "MR", "MS", "Haste"] as const;

export function TrophyCase({ trophies }: { trophies: Trophy[] }) {
  const [stat, setStat] = useState<(typeof STATS)[number]>("All");
  const visible = useMemo(() => trophies.filter((trophy) => stat === "All" || trophy.stat === stat).sort((left, right) => right.value - left.value), [stat, trophies]);
  return <main className="trophy-shell">
    <header className="collection-header"><div><span className="eyebrow">Local Live Client observations</span><h1>Trophy Case</h1><p>Your largest transient in-game stats, recorded locally while the companion was active.</p></div><nav><Link href="/history">Match history</Link><Link href="/extreme-builds">Extreme builds</Link></nav></header>
    <nav className="trophy-filters" aria-label="Trophy stat filters">{STATS.map((name) => <button type="button" className={stat === name ? "active" : ""} onClick={() => setStat(name)} key={name}>{name}</button>)}</nav>
    {visible.length === 0 ? <div className="collection-empty"><strong>{trophies.length ? `No ${stat} trophies recorded` : "No trophies yet"}</strong><p>Play an Arena or ARAM: Mayhem game while the overlay is running to record your first peak.</p></div> : <section className="trophy-grid">{visible.map((trophy, index) => <article className={`trophy-card trophy-${Math.min(index + 1, 3)}`} key={`${trophy.id}:${trophy.stat}`}><div className="trophy-rank">#{index + 1}</div>{trophy.championIconUrl ? <Image src={trophy.championIconUrl} alt="" width={58} height={58} unoptimized /> : <div className="history-placeholder">?</div>}<div className="trophy-copy"><span>{trophy.stat} record · {new Date(trophy.endedAt).toLocaleDateString()}</span><strong>{trophy.value.toLocaleString(undefined, { maximumFractionDigits: trophy.stat === "AS" ? 2 : 0 })} {trophy.stat}</strong><b>{trophy.championName}</b><div>{trophy.augments.length ? trophy.augments.map((augment) => <em key={augment.key}>{augment.name}</em>) : <em>Augment names unavailable</em>}</div></div></article>)}</section>}
  </main>;
}
