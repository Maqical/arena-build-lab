"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { MatchHistoryEntry } from "@/lib/history";

function number(value: number | null): string {
  return value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function MatchHistory({ entries }: { entries: MatchHistoryEntry[] }) {
  const [crazyOnly, setCrazyOnly] = useState(false);
  const filtered = useMemo(() => crazyOnly ? entries.filter((entry) => entry.crazy) : entries, [crazyOnly, entries]);
  return <main className="history-shell">
    <header className="collection-header"><div><span className="eyebrow">Immutable local match warehouse</span><h1>Match History</h1><p>Recent Arena games ingested from your personal cohort. Crazy Builds highlights matches with recorded peak HP ≥100k or AD ≥2k.</p></div><nav><Link href="/trophies">Trophy case</Link><Link href="/overlay">Overlay</Link><Link href="/">Build Lab</Link></nav></header>
    <div className="collection-toolbar"><strong>{filtered.length} games</strong><label><input type="checkbox" checked={crazyOnly} onChange={(event) => setCrazyOnly(event.target.checked)} /> Crazy Builds only</label></div>
    <section className="history-list">{filtered.length === 0 ? <div className="collection-empty"><strong>{entries.length ? "No crazy builds in this view" : "No ingested Arena matches yet"}</strong><p>Run <code>npm run riot:sync -- --player=&quot;Name#Tag&quot;</code> to populate your personal cohort.</p></div> : filtered.map((entry) => <article className={`history-card ${entry.crazy ? "crazy" : ""}`} key={`${entry.matchId}:${entry.championId}`}>
      {entry.championIconUrl ? <Image src={entry.championIconUrl} alt="" width={48} height={48} unoptimized /> : <div className="history-placeholder">?</div>}
      <div className="history-main"><div className="history-title"><strong>{entry.championName}</strong><span>{entry.placement == null ? "Placement unknown" : `${entry.placement}${entry.placement === 1 ? "st" : entry.placement === 2 ? "nd" : entry.placement === 3 ? "rd" : "th"}`} place · Patch {entry.patch}</span></div><div className="history-augments">{entry.augments.length ? entry.augments.map((augment) => <span key={augment.key} title={augment.name}>{augment.name}</span>) : <em>No augment IDs recorded</em>}</div></div>
      <div className="history-stats"><span>{new Date(entry.startedAt).toLocaleDateString()}</span>{entry.crazy && <b>CRAZY BUILD</b>}<small>Peak HP {number(entry.maxHp)} · AD {number(entry.maxAd)}</small></div>
    </article>)}</section>
  </main>;
}
