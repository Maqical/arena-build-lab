"use client";

import Image from "next/image";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";
import type { LiveResolveResponse, OverlayCatalogEntity } from "@/lib/live-overlay-types";
import { uncataloguedSelectionLabel } from "@/lib/selection-label";

function number(value: number | undefined | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function LiveGameHUD({ snapshot, build, augments, items, unresolvedAugmentRefs = [] }: {
  snapshot: GameStateSnapshot;
  build: LiveResolveResponse | null;
  augments: OverlayCatalogEntity[];
  items: OverlayCatalogEntity[];
  unresolvedAugmentRefs?: string[];
}) {
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
    <div className="live-game-identity"><strong>{snapshot.champion.name || "League champion"}</strong><span>{snapshot.mode === "aram_mayhem" ? "ARAM: Mayhem" : "Arena"} · Level {snapshot.champion.level}</span></div>
    <div className="live-game-stats">{rows.map(([label, current, theoretical, digits]) => <div key={label}>
      <span>{label}</span><strong>{number(current, digits)}</strong><small>{theoretical == null ? "—" : `theory ${number(theoretical, digits)}`}</small>
    </div>)}</div>
    <div className="live-craze"><div><span>Craze Factor</span><strong>{build?.crazeFactor ?? "—"}</strong></div><small>{build?.crazeLabel ?? "Resolver comparison unavailable"}</small></div>
    <div className="overlay-section-title"><span>Live build items</span><b>{items.length}</b></div>
    {items.length > 0 ? <div className="live-item-list">{items.map((item) => <div key={item.entityKey}><Image src={item.iconUrl} width={32} height={32} alt="" unoptimized /><span>{item.name}</span></div>)}</div> : <p className="overlay-muted">No completed item or component over 500 gold is currently visible.</p>}
    <div className="overlay-section-title"><span>Chosen {snapshot.mode === "aram_mayhem" ? "cards" : "augments"}</span><b>{augments.length + unresolvedAugmentRefs.length}</b></div>
    {augments.length + unresolvedAugmentRefs.length > 0 ? <div className="live-augment-list">
      {augments.map((augment) => <div key={augment.entityKey}><Image src={augment.iconUrl} width={32} height={32} alt="" unoptimized /><span>{augment.name}</span></div>)}
      {unresolvedAugmentRefs.map((reference) => <div className="uncatalogued" key={reference}><span className="live-augment-unknown">?</span><span>{uncataloguedSelectionLabel(reference)}</span></div>)}
    </div> : <p className="overlay-muted">No selected {snapshot.mode === "aram_mayhem" ? "Mayhem card" : "augment"} IDs are exposed yet. Rune, perk, card, KIWI, and augment-granted spell events are monitored automatically; Ctrl+Shift+A remains available for offer capture.</p>}
  </section>;
}
