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
  const [champion, setChampion] = useState("");
  const [placement, setPlacement] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState("");
  const champions = useMemo(() => [...new Set(entries.map((entry) => entry.championName))].sort(), [entries]);
  const filtered = useMemo(() => entries
    .filter((entry) => !crazyOnly || entry.crazy)
    .filter((entry) => !champion || entry.championName === champion)
    .filter((entry) => !placement || String(entry.placement) === placement), [champion, crazyOnly, entries, placement]);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * 20, safePage * 20);

  return <main className="history-shell">
    <header className="collection-header"><div><span className="eyebrow">Immutable local match warehouse</span><h1>Match History</h1><p>Review placements, augments, completed items, KDA, and locally observed stat peaks from your personal Arena games.</p></div><nav><Link href="/trophies">Trophy case</Link><Link href="/live">Live view</Link></nav></header>
    <div className="history-filterbar"><label>Champion<select value={champion} onChange={(event) => { setChampion(event.target.value); setPage(1); }}><option value="">All champions</option>{champions.map((name) => <option key={name}>{name}</option>)}</select></label><label>Placement<select value={placement} onChange={(event) => { setPlacement(event.target.value); setPage(1); }}><option value="">All placements</option>{[1,2,3,4,5,6,7,8].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label className="history-crazy"><input type="checkbox" checked={crazyOnly} onChange={(event) => { setCrazyOnly(event.target.checked); setPage(1); }} /> Crazy builds only</label><strong>{filtered.length} games</strong></div>
    <section className="history-list">{filtered.length === 0 ? <div className="collection-empty"><strong>{entries.length ? "No matches meet these filters" : "No ingested Arena matches yet"}</strong><p>Add your Riot ID in Settings, then run a personal match sync.</p></div> : visible.map((entry) => { const key = `${entry.matchId}:${entry.championId}`; const open = expanded === key; return <article className={`history-card ${entry.crazy ? "crazy" : ""} ${open ? "expanded" : ""}`} key={key} onClick={() => setExpanded(open ? "" : key)}>
      <div className={`history-placement place-${entry.placement ?? 0}`}><strong>{entry.placement ?? "—"}</strong><span>place</span></div>
      {entry.championIconUrl ? <Image src={entry.championIconUrl} alt="" width={52} height={52} unoptimized /> : <div className="history-placeholder">?</div>}
      <div className="history-main"><div className="history-title"><strong>{entry.championName}</strong><span>Level {entry.level ?? "—"} · {entry.kills ?? "—"}/{entry.deaths ?? "—"}/{entry.assists ?? "—"} · {Math.round(entry.durationSeconds / 60)} min</span></div><div className="history-icon-row">{entry.augments.length ? entry.augments.map((augment) => <span className={augment.catalogued ? "" : "uncatalogued"} key={augment.key} title={augment.name}>{augment.iconUrl ? <Image src={augment.iconUrl} alt="" width={25} height={25} unoptimized /> : <b aria-hidden="true">?</b>}<em>{augment.name}</em></span>) : <i>No augments recorded</i>}</div></div>
      <div className="history-item-row">{entry.items.map((item) => <span key={item.key} title={item.name}>{item.iconUrl ? <Image src={item.iconUrl} alt={item.name} width={30} height={30} unoptimized /> : item.name}</span>)}</div>
      <div className="history-stats"><span>{new Date(entry.startedAt).toLocaleDateString()}</span>{entry.crazy && <b>CRAZY BUILD</b>}<small>Peak HP {number(entry.maxHp)} · AD {number(entry.maxAd)}</small></div>
      {open && <div className="history-detail"><strong>Augment path</strong><p>{entry.augments.map((augment) => augment.name).join(" → ") || "No augment IDs recorded"}</p><strong>Final items</strong><p>{entry.items.map((item) => item.name).join(" · ") || "No completed items recorded"}</p><small>{entry.matchId} · {entry.region.toUpperCase()} · Patch {entry.patch}</small></div>}
    </article>; })}</section>
    {filtered.length > 20 && <nav className="history-pagination" aria-label="Match history pages"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {safePage} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></nav>}
  </main>;
}
