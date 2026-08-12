"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Champion, EntityOption, PersonalRun, PersonalStats } from "@/lib/types";

const EMPTY_PERSONAL_STATS: PersonalStats = { totalRuns: 0, wins: 0, winRate: 0, topHalfRate: 0, averagePlacement: 0, entityPerformance: [] };

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }

export function RunTracker({ champions, entityOptions, initialChampionKey }: { champions: Champion[]; entityOptions: EntityOption[]; initialChampionKey: string }) {
  const initialChampion = champions.find((champion) => champion.key === initialChampionKey) ?? champions[0];
  const [championId, setChampionId] = useState(initialChampion?.id ?? 0);
  const [filterChampionId, setFilterChampionId] = useState(0);
  const [placement, setPlacement] = useState(1);
  const [teamCount, setTeamCount] = useState(8);
  const [notes, setNotes] = useState("");
  const [entityToAdd, setEntityToAdd] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [runs, setRuns] = useState<PersonalRun[]>([]);
  const [stats, setStats] = useState<PersonalStats>(EMPTY_PERSONAL_STATS);
  const [status, setStatus] = useState("");
  const selectedEntities = useMemo(() => selectedKeys.flatMap((key) => entityOptions.find((entity) => entity.entityKey === key) ?? []), [selectedKeys, entityOptions]);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterChampionId) params.set("championId", String(filterChampionId));
    const response = await fetch(`/api/personal-runs?${params}`, { cache: "no-store" });
    const payload = await response.json() as { runs: PersonalRun[]; stats: PersonalStats };
    setRuns(payload.runs);
    setStats(payload.stats);
  }, [filterChampionId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (filterChampionId) params.set("championId", String(filterChampionId));
    fetch(`/api/personal-runs?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((payload: { runs: PersonalRun[]; stats: PersonalStats }) => {
        setRuns(payload.runs);
        setStats(payload.stats);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("Could not load local runs.");
      });
    return () => controller.abort();
  }, [filterChampionId]);

  async function saveRun(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Saving…");
    const response = await fetch("/api/personal-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ championId, placement, teamCount, notes, entityKeys: selectedKeys }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setStatus(payload.error ?? "Could not save this run."); return; }
    setNotes("");
    setSelectedKeys([]);
    setStatus("Run saved locally.");
    await refresh();
  }

  async function removeRun(id: number) {
    const response = await fetch(`/api/personal-runs/${id}`, { method: "DELETE" });
    if (response.ok) await refresh();
  }

  return (
    <section className="tool-page" data-testid="run-tracker">
      <div className="tool-hero">
        <div><span className="eyebrow">Your evidence, not a global claim</span><h2>My Arena Runs</h2></div>
        <p>Record the path you actually played. The dashboard measures your placements and your results with each item or augment over time.</p>
      </div>
      <section className="personal-metrics">
        <div><span>Recorded runs</span><strong>{stats.totalRuns}</strong></div>
        <div><span>First-place rate</span><strong>{stats.totalRuns ? percent(stats.winRate) : "—"}</strong></div>
        <div><span>Top-half rate</span><strong>{stats.totalRuns ? percent(stats.topHalfRate) : "—"}</strong></div>
        <div><span>Average placement</span><strong>{stats.totalRuns ? stats.averagePlacement.toFixed(2) : "—"}</strong></div>
      </section>
      <div className="runs-layout">
        <form className="tool-card run-form" onSubmit={saveRun}>
          <div className="tool-card-heading"><div><span className="eyebrow">Manual entry</span><h3>Log a completed run</h3></div></div>
          <div className="run-form-grid">
            <label><span>Champion</span><select value={championId} onChange={(event) => setChampionId(Number(event.target.value))}>{champions.map((champion) => <option value={champion.id} key={champion.id}>{champion.name}</option>)}</select></label>
            <label><span>Teams</span><input type="number" min="2" max="16" value={teamCount} onChange={(event) => { const count = Number(event.target.value); setTeamCount(count); setPlacement((value) => Math.min(value, count)); }} /></label>
            <label><span>Placement</span><input type="number" min="1" max={teamCount} value={placement} onChange={(event) => setPlacement(Number(event.target.value))} /></label>
          </div>
          <label className="run-entity-picker"><span>Add item or augment</span>
            <select value={entityToAdd} onChange={(event) => {
              const key = event.target.value;
              setEntityToAdd("");
              if (key) setSelectedKeys((current) => current.includes(key) ? current : [...current, key]);
            }}>
              <option value="">Choose from the current catalog…</option>
              <optgroup label="Augments">{entityOptions.filter((entity) => entity.kind === "augment").map((entity) => <option value={entity.entityKey} key={entity.entityKey}>{entity.name}</option>)}</optgroup>
              <optgroup label="Items">{entityOptions.filter((entity) => entity.kind === "item").map((entity) => <option value={entity.entityKey} key={entity.entityKey}>{entity.name}</option>)}</optgroup>
            </select>
          </label>
          <div className="selected-run-entities">
            {selectedEntities.map((entity) => <button type="button" onClick={() => setSelectedKeys((current) => current.filter((key) => key !== entity.entityKey))} key={entity.entityKey}><Image src={entity.iconUrl} alt="" width={25} height={25} unoptimized />{entity.name}<span>×</span></button>)}
          </div>
          <label className="notes-field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="What came online, what failed, duo/champion interaction…" /></label>
          <button className="primary-action" type="submit">Save run</button>
          <span className="save-status" role="status">{status}</span>
        </form>

        <section className="tool-card performance-card">
          <div className="tool-card-heading">
            <div><span className="eyebrow">Personal samples</span><h3>What works for you</h3></div>
            <select aria-label="Filter personal stats by champion" value={filterChampionId} onChange={(event) => setFilterChampionId(Number(event.target.value))}><option value="0">All champions</option>{champions.map((champion) => <option value={champion.id} key={champion.id}>{champion.name}</option>)}</select>
          </div>
          <div className="performance-table">
            <div className="table-row table-head"><span>Choice</span><span>Games</span><span>1st</span><span>Top half</span><span>Avg</span></div>
            {stats.entityPerformance.map((entry) => (
              <div className="table-row" key={entry.entityKey}>
                <span className="performance-name"><Image src={entry.iconUrl} alt="" width={28} height={28} unoptimized /><b>{entry.name}</b></span>
                <span>{entry.games}</span><span>{percent(entry.winRate)}</span><span>{percent(entry.topHalfRate)}</span><span>{entry.averagePlacement.toFixed(2)}</span>
              </div>
            ))}
            {stats.entityPerformance.length === 0 && <p className="field-help">Log a run with items or augments to begin building your comparison table.</p>}
          </div>
        </section>
      </div>
      <section className="tool-card recent-runs">
        <div className="tool-card-heading"><div><span className="eyebrow">Local match journal</span><h3>Recent runs</h3></div></div>
        {runs.map((run) => (
          <article key={run.id}>
            <Image src={run.champion.iconUrl} alt="" width={38} height={38} unoptimized />
            <div><strong>{run.champion.name} · #{run.placement} of {run.teamCount}</strong><span>{new Date(run.playedAt).toLocaleString()} · patch {run.patch}</span></div>
            <div className="run-icons">{run.entities.slice(0, 10).map((entity) => <Image src={entity.iconUrl} alt={entity.name} title={entity.name} width={28} height={28} unoptimized key={entity.entityKey} />)}</div>
            <p>{run.notes}</p>
            <button type="button" onClick={() => removeRun(run.id)}>Delete</button>
          </article>
        ))}
        {runs.length === 0 && <p className="field-help">No runs recorded yet. Your entries stay in the local Arena database.</p>}
      </section>
    </section>
  );
}
