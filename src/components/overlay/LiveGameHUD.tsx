"use client";

import Image from "next/image";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";
import type { LiveResolveResponse, OverlayCatalogEntity } from "@/lib/live-overlay-types";

function number(value: number | undefined | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function LiveGameHUD({ snapshot, build, augments }: { snapshot: GameStateSnapshot; build: LiveResolveResponse | null; augments: OverlayCatalogEntity[] }) {
  const stats = snapshot.liveStats;
  const theory = build?.build.stats;
  const rows = [
    ["HP", stats?.maxHealth, theory?.maxHealth, 0],
    ["AD", stats?.attackDamage, theory?.totalAttackDamage, 1],
    ["AP", stats?.abilityPower, theory?.abilityPower, 1],
    ["AS", stats?.attackSpeed, theory?.attackSpeed, 2],
  ] as const;
  return <section className="live-game-hud">
    <div className="overlay-section-title"><span>Live game HUD</span><b>{stats ? "Updating" : "Waiting"}</b></div>
    <div className="live-game-identity"><strong>{snapshot.champion.name || "Arena champion"}</strong><span>Level {snapshot.champion.level}</span></div>
    <div className="live-game-stats">{rows.map(([label, current, theoretical, digits]) => <div key={label}>
      <span>{label}</span><strong>{number(current, digits)}</strong><small>{theoretical == null ? "—" : `theory ${number(theoretical, digits)}`}</small>
    </div>)}</div>
    <div className="live-craze"><div><span>Craze Factor</span><strong>{build?.crazeFactor ?? "—"}</strong></div><small>{build?.crazeLabel ?? "Resolver comparison unavailable"}</small></div>
    <div className="overlay-section-title"><span>Chosen augments</span><b>{augments.length}</b></div>
    {augments.length > 0 ? <div className="live-augment-list">{augments.map((augment) => <div key={augment.entityKey}><Image src={augment.iconUrl} width={25} height={25} alt="" unoptimized /><span>{augment.name}</span></div>)}</div> : <p className="overlay-muted">Augments will appear when the local client exposes them.</p>}
  </section>;
}
