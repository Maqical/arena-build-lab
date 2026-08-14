"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { MatchHistoryEntry, Trophy } from "@/lib/history";

type DashboardData = {
  overview: { patch: string; dataPatch?: string; champions: number; augments: number; items: number; videos: number; curatedCombos: number; discoveredCombos: number };
  matches: MatchHistoryEntry[];
  trophies: Trophy[];
  performance: Array<{ matchId:string;championName:string;startedAt:string;score:number;grade:string }>;
  warehouse: { matches: number; participants: number; observations: number; snapshots: number };
};

function place(value: number | null): string {
  if (value == null) return "—";
  return `${value}${value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th"}`;
}

export function Dashboard({ data }: { data: DashboardData }) {
  const [worker, setWorker] = useState<"riot" | "data" | null>(null);
  const [message, setMessage] = useState("");
  const run = async (kind: "riot" | "data") => {
    setWorker(kind); setMessage("");
    const result = await window.arenaDesktop?.runWorker(kind);
    setMessage(result?.message ?? "Open the desktop app to run local workers.");
    setWorker(null);
  };
  return <main className="dashboard-page">
    <header className="dashboard-hero"><div><span className="eyebrow">Local Arena companion</span><h1>Your command center</h1><p>Live game context, build research, personal history, and theoretical extremes—without leaving the desktop app.</p></div><button type="button" onClick={() => void window.arenaDesktop?.openOverlay()}>Open live overlay</button></header>
    <section className="dashboard-status-grid" aria-label="Data status">
      <article><span>Current patch</span><strong>{data.overview.patch}</strong><small>{data.overview.champions} champions indexed{data.overview.dataPatch && data.overview.dataPatch !== data.overview.patch ? ` · Data build ${data.overview.dataPatch}` : ""}</small></article>
      <article><span>Local matches</span><strong>{data.warehouse.matches.toLocaleString()}</strong><small>{data.warehouse.participants.toLocaleString()} participant records</small></article>
      <article><span>Meta samples</span><strong>{data.warehouse.snapshots.toLocaleString()}</strong><small>provenance-first snapshots</small></article>
      <article><span>Catalog</span><strong>{(data.overview.augments + data.overview.items).toLocaleString()}</strong><small>{data.overview.augments} augments · {data.overview.items} items</small></article>
    </section>
    <section className="dashboard-actions"><div><h2>Quick actions</h2><p>Refresh data or jump straight into the live companion.</p></div><button type="button" onClick={() => void run("riot")} disabled={worker !== null}>{worker === "riot" ? "Syncing matches…" : "Sync Riot matches"}</button><button type="button" onClick={() => void run("data")} disabled={worker !== null}>{worker === "data" ? "Syncing patch…" : "Sync game data"}</button><Link href="/extreme-builds">Browse extreme builds</Link>{message && <output>{message}</output>}</section>
    <div className="dashboard-columns">
      <section className="dashboard-panel"><header><div><span className="eyebrow">Personal warehouse</span><h2>Recent matches</h2></div><Link href="/history">View all</Link></header>{data.matches.length ? <div className="dashboard-match-list">{data.matches.slice(0, 5).map((match) => <article key={`${match.matchId}:${match.championId}`}>{match.championIconUrl ? <Image src={match.championIconUrl} alt="" width={42} height={42} unoptimized /> : <span className="dashboard-avatar">?</span>}<div><strong>{match.championName}</strong><small>{new Date(match.startedAt).toLocaleDateString()} · Patch {match.patch}</small></div><b className={`place-${match.placement ?? 0}`}>{place(match.placement)}</b></article>)}</div> : <div className="dashboard-empty">No personal Arena matches yet. Add your Riot ID in Settings, then sync.</div>}</section>
      <section className="dashboard-panel"><header><div><span className="eyebrow">Recorded peaks</span><h2>Top trophies</h2></div><Link href="/trophies">View all</Link></header>{data.trophies.length ? <div className="dashboard-trophy-list">{data.trophies.slice(0, 3).map((trophy, index) => <article key={`${trophy.id}:${trophy.stat}`}><span>#{index + 1}</span><div><strong>{trophy.value.toLocaleString()} {trophy.stat}</strong><small>{trophy.championName}</small></div></article>)}</div> : <div className="dashboard-empty">Your first live stat record will appear here after a game.</div>}</section>
    </div>
    {data.performance.length>0&&<section className="dashboard-panel performance-trend"><header><div><span className="eyebrow">Personal form</span><h2>Performance trend</h2></div><Link href="/history">Match details</Link></header><div>{data.performance.map((entry)=><span key={entry.matchId} title={`${entry.championName} · ${entry.grade} · ${entry.score.toFixed(0)}/100`}><i style={{height:`${Math.max(8,entry.score)}%`}}/><small>{entry.grade}</small></span>)}</div></section>}
  </main>;
}
