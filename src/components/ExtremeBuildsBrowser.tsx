"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtremeBuildCsvRow } from "@/lib/extreme-build-csv-core";
import type { OverlayCatalogEntity } from "@/lib/live-overlay-types";
import type { Champion } from "@/lib/types";

type SortKey = "maxHealth" | "totalAttackDamage" | "abilityPower" | "attackSpeed";
const SORTS: Array<{ key: SortKey; label: string; short: string }> = [
  { key: "maxHealth", label: "Max HP", short: "HP" },
  { key: "totalAttackDamage", label: "Max AD", short: "AD" },
  { key: "abilityPower", label: "Max AP", short: "AP" },
  { key: "attackSpeed", label: "Max AS", short: "AS" },
];
const normalized = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
const display = (value: number, digits = 0) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "∞";
const objectiveLabel = (value: string) => SORTS.find((sort) => sort.key === value)?.label ?? value;

function clipboardText(build: ExtremeBuildCsvRow): string {
  return [`Arena Build Lab — ${build.champion} level ${build.level}`, `Objective: ${objectiveLabel(build.objective)} #${build.rank}`, `Augments: ${build.augments.join(" | ")}`, build.fixedItems.length ? `Items: ${build.fixedItems.join(" | ")}` : "", `Stats: ${display(build.stats.maxHealth)} HP | ${display(build.stats.totalAttackDamage, 1)} AD | ${display(build.stats.abilityPower, 1)} AP | ${display(build.stats.attackSpeed, 2)} AS`].filter(Boolean).join("\n");
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(value); return; } catch { /* fallback */ } }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function BuildCard({ build, champion, entitiesByName, cardKey }: { build: ExtremeBuildCsvRow; champion?: Champion; entitiesByName: Map<string, OverlayCatalogEntity>; cardKey: string }) {
  const copyButton = useRef<HTMLButtonElement>(null);
  const craze = Math.min(100, Math.max(10, Math.round((build.stats.maxHealth / 9000 + build.stats.totalAttackDamage / 900 + build.stats.abilityPower / 700 + build.stats.attackSpeed / 2.5) * 25)));
  useEffect(() => {
    const button = copyButton.current;
    if (!button) return;
    const copyBuild = () => { button.textContent = "Copied"; window.setTimeout(() => void copyText(clipboardText(build)), 0); window.setTimeout(() => { if (button.isConnected) button.textContent = "Copy build"; }, 5000); };
    button.addEventListener("click", copyBuild);
    return () => button.removeEventListener("click", copyBuild);
  }, [build]);
  return <article className="extreme-row extreme-build-card" data-build-key={cardKey}>
    <div className="build-card-head"><div className="extreme-champion-cell">{champion && <Image src={champion.iconUrl} width={46} height={46} alt="" unoptimized />}<div><strong>{build.champion}</strong><span>{objectiveLabel(build.objective)} · Rank #{build.rank}</span></div></div><span className="build-card-level">Lv {build.level}</span></div>
    <div className="build-card-augments">{build.augments.map((augment, augmentIndex) => { const entity = entitiesByName.get(normalized(augment)); return <span title={entity?.description || `${augment} conversion path`} key={`${augment}-${augmentIndex}`}>{entity?.iconUrl ? <Image src={entity.iconUrl} width={31} height={31} alt="" unoptimized /> : <b>{augmentIndex + 1}</b>}<em>{augment}</em></span>; })}</div>
    <div className="build-card-craze"><div><span>Craze meter</span><strong>{craze}%</strong></div><i><b style={{ width: `${craze}%` }} /></i></div>
    <div className="build-card-stats"><div><span>HP</span><strong>{display(build.stats.maxHealth)}</strong></div><div><span>AD</span><strong>{display(build.stats.totalAttackDamage, 1)}</strong></div><div><span>AP</span><strong>{display(build.stats.abilityPower, 1)}</strong></div><div><span>AS</span><strong>{display(build.stats.attackSpeed, 2)}</strong></div></div>
    {build.fixedItems.length > 0 && <p className="build-card-items">Items · {build.fixedItems.join(" · ")}</p>}
    <button className="copy-build" type="button" ref={copyButton}>Copy build</button>
  </article>;
}

export function ExtremeBuildsBrowser({ builds, champions, entities }: { builds: ExtremeBuildCsvRow[]; champions: Champion[]; entities: OverlayCatalogEntity[] }) {
  const [championFilter, setChampionFilter] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("maxHealth");
  const championsByName = useMemo(() => new Map(champions.map((champion) => [normalized(champion.name), champion])), [champions]);
  const entitiesByName = useMemo(() => new Map(entities.map((entity) => [normalized(entity.name), entity])), [entities]);
  const buildChampions = useMemo(() => [...new Set(builds.map((build) => build.champion))].sort(), [builds]);
  const filtered = useMemo(() => {
    const query = normalized(search);
    return [...builds].filter((build) => !championFilter || build.champion === championFilter)
      .filter((build) => !objectiveFilter || build.objective === objectiveFilter)
      .filter((build) => !query || normalized(`${build.champion} ${build.augments.join(" ")} ${build.fixedItems.join(" ")}`).includes(query))
      .sort((left, right) => right.stats[sortKey] - left.stats[sortKey] || left.champion.localeCompare(right.champion) || left.rank - right.rank);
  }, [builds, championFilter, objectiveFilter, search, sortKey]);

  return <main className="extreme-shell">
    <header className="extreme-header"><div><span className="eyebrow">Fixed-point benchmark archive</span><h1>Extreme Build Browser</h1><p>Explore the most explosive Arena conversion paths, with resolver outputs, augment mechanics, and a visual Craze meter.</p></div><div><Link href="/">Build Lab</Link><Link href="/overlay">Live overlay</Link></div></header>
    <section className="extreme-controls">
      <label>Champion<select aria-label="Champion filter" value={championFilter} onChange={(event) => setChampionFilter(event.target.value)}><option value="">All champions</option>{buildChampions.map((champion) => <option key={champion}>{champion}</option>)}</select></label>
      <label>Objective<select aria-label="Objective filter" value={objectiveFilter} onChange={(event) => setObjectiveFilter(event.target.value)}><option value="">All objectives</option>{SORTS.map((sort) => <option value={sort.key} key={sort.key}>{sort.label}</option>)}</select></label>
      <label className="extreme-search">Search<input aria-label="Search builds" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Augment, item, champion…" /></label>
      <div className="extreme-sort"><span>Sort</span>{SORTS.map((sort) => <button className={sortKey === sort.key ? "active" : ""} type="button" onClick={() => setSortKey(sort.key)} key={sort.key}>{sort.short}</button>)}</div>
    </section>
    <div className="extreme-summary"><strong>{filtered.length}</strong> builds shown <span>·</span> resolver benchmark archive</div>
    <section className="extreme-table extreme-build-grid" aria-live="polite">
      {filtered.map((build, index) => {
        const champion = championsByName.get(normalized(build.champion));
        const key = `${build.objective}-${build.rank}-${build.champion}-${index}`;
        return <BuildCard build={build} champion={champion} entitiesByName={entitiesByName} cardKey={key} key={key} />;
      })}
      {filtered.length === 0 && <div className="extreme-empty">No mathematical builds match these filters.</div>}
    </section>
    <p className="extreme-footnote">Hover an augment to inspect its tooltip and conversion rationale. Copied plans are readable notes for your next Arena game.</p>
  </main>;
}
