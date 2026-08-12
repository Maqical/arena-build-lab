"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ExtremeBuildCsvRow } from "@/lib/extreme-build-csv-core";
import type { Champion } from "@/lib/types";

type SortKey = "maxHealth" | "totalAttackDamage" | "abilityPower" | "attackSpeed";

const SORTS: Array<{ key: SortKey; label: string; short: string }> = [
  { key: "maxHealth", label: "Max HP", short: "HP" },
  { key: "totalAttackDamage", label: "Max AD", short: "AD" },
  { key: "abilityPower", label: "Max AP", short: "AP" },
  { key: "attackSpeed", label: "Max AS", short: "AS" },
];

function normalized(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function display(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "∞";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function objectiveLabel(value: string): string {
  return SORTS.find((sort) => sort.key === value)?.label ?? value;
}

function buildClipboardText(build: ExtremeBuildCsvRow): string {
  const scenario = Object.entries(build.scenario).filter(([, value]) => Number(value) > 0).map(([key, value]) => `${key}=${value}`).join(", ");
  return [
    `Arena Build Lab — ${build.champion} level ${build.level}`,
    `Objective: ${objectiveLabel(build.objective)} #${build.rank}`,
    `Augments: ${build.augments.join(" | ")}`,
    build.fixedItems.length ? `Items: ${build.fixedItems.join(" | ")}` : "",
    `Stats: ${display(build.stats.maxHealth)} HP | ${display(build.stats.totalAttackDamage, 1)} AD | ${display(build.stats.abilityPower, 1)} AP | ${display(build.stats.attackSpeed, 2)} AS`,
    scenario ? `Benchmark inputs: ${scenario}` : "",
    build.theoreticalUnbounded ? "Theoretical scaling: unbounded; displayed value uses the recorded benchmark inputs." : "",
  ].filter(Boolean).join("\n");
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; }
    catch { /* Fall through to the legacy user-gesture copy path. */ }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function ExtremeBuildsBrowser({ builds, champions }: { builds: ExtremeBuildCsvRow[]; champions: Champion[] }) {
  const [championFilter, setChampionFilter] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("maxHealth");
  const [copied, setCopied] = useState("");
  const championsByName = useMemo(() => new Map(champions.map((champion) => [normalized(champion.name), champion])), [champions]);
  const buildChampions = useMemo(() => [...new Set(builds.map((build) => build.champion))].sort(), [builds]);

  const filtered = useMemo(() => {
    const query = normalized(search);
    return builds
      .filter((build) => !championFilter || build.champion === championFilter)
      .filter((build) => !objectiveFilter || build.objective === objectiveFilter)
      .filter((build) => !query || normalized(`${build.champion} ${build.augments.join(" ")} ${build.fixedItems.join(" ")}`).includes(query))
      .sort((left, right) => right.stats[sortKey] - left.stats[sortKey] || left.champion.localeCompare(right.champion) || left.rank - right.rank);
  }, [builds, championFilter, objectiveFilter, search, sortKey]);

  async function copyBuild(build: ExtremeBuildCsvRow, key: string) {
    await copyText(buildClipboardText(build));
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1_600);
  }

  return (
    <main className="extreme-shell">
      <header className="extreme-header">
        <div><span className="eyebrow">Fixed-point benchmark archive</span><h1>Extreme Build Browser</h1><p>Browse the highest theoretical Arena stat conversions produced by the resolver. Every number uses the recorded finite benchmark; ∞ marks champions whose passive scaling has no mathematical ceiling.</p></div>
        <div><Link href="/">Build Lab</Link><Link href="/overlay">Live overlay</Link></div>
      </header>

      <section className="extreme-controls">
        <label>Champion<select aria-label="Champion filter" value={championFilter} onChange={(event) => setChampionFilter(event.target.value)}><option value="">All champions</option>{buildChampions.map((champion) => <option key={champion}>{champion}</option>)}</select></label>
        <label>Objective<select aria-label="Objective filter" value={objectiveFilter} onChange={(event) => setObjectiveFilter(event.target.value)}><option value="">All objectives</option>{SORTS.map((sort) => <option value={sort.key} key={sort.key}>{sort.label}</option>)}</select></label>
        <label className="extreme-search">Search<input aria-label="Search builds" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Augment, item, champion…" /></label>
        <div className="extreme-sort"><span>Sort descending</span>{SORTS.map((sort) => <button className={sortKey === sort.key ? "active" : ""} type="button" onClick={() => setSortKey(sort.key)} key={sort.key}>{sort.short}</button>)}</div>
      </section>

      <div className="extreme-summary"><strong>{filtered.length}</strong> builds shown <span>·</span> source: <code>data/extreme_builds.csv</code></div>
      <section className="extreme-table" aria-live="polite">
        <div className="extreme-row extreme-table-head"><span>Champion / objective</span><span>Four-augment path</span>{SORTS.map((sort) => <button type="button" onClick={() => setSortKey(sort.key)} key={sort.key}>{sort.short}{sortKey === sort.key ? " ↓" : ""}</button>)}<span>Copy</span></div>
        {filtered.map((build, index) => {
          const champion = championsByName.get(normalized(build.champion));
          const key = `${build.objective}-${build.rank}-${build.champion}-${index}`;
          return <article className="extreme-row" key={key}>
            <div className="extreme-champion-cell">
              {champion && <Image src={champion.iconUrl} width={38} height={38} alt="" unoptimized />}
              <div><strong>{build.champion}</strong><span>{objectiveLabel(build.objective)} #{build.rank} · Lv {build.level}{build.theoreticalUnbounded ? " · ∞ scaling" : ""}</span></div>
            </div>
            <div className="extreme-augment-path">{build.augments.map((augment, augmentIndex) => <span key={`${augment}-${augmentIndex}`}><b>{augmentIndex + 1}</b>{augment}</span>)}{build.fixedItems.map((item) => <em key={item}>Item · {item}</em>)}</div>
            <strong data-label="HP">{display(build.stats.maxHealth)}</strong>
            <strong data-label="AD">{display(build.stats.totalAttackDamage, 1)}</strong>
            <strong data-label="AP">{display(build.stats.abilityPower, 1)}</strong>
            <strong data-label="AS">{display(build.stats.attackSpeed, 2)}</strong>
            <button className="copy-build" type="button" onClick={() => void copyBuild(build, key)}>{copied === key ? "Copied" : "Copy build"}</button>
          </article>;
        })}
        {filtered.length === 0 && <div className="extreme-empty">No mathematical builds match these filters.</div>}
      </section>
      <p className="extreme-footnote">Copied loadouts are readable build plans for notes or chat. The League client does not provide an Arena-augment import format.</p>
    </main>
  );
}
