"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChampSelectRecommendation } from "@/lib/champ-select-types";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";
import type { Champion } from "@/lib/types";

function normalized(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function display(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function ChampSelectAssistant({ champions, snapshot: externalSnapshot, compact = false }: { champions: Champion[]; snapshot?: GameStateSnapshot | null; compact?: boolean }) {
  const [streamSnapshot, setStreamSnapshot] = useState<GameStateSnapshot | null>(null);
  const [previewChampion, setPreviewChampion] = useState("");
  const [recommendation, setRecommendation] = useState<ChampSelectRecommendation | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const snapshot = externalSnapshot === undefined ? streamSnapshot : externalSnapshot;
  const liveChampion = champions.find((champion) => champion.id === snapshot?.champion.id)
    ?? champions.find((champion) => normalized(champion.name) === normalized(snapshot?.champion.name ?? ""));
  const championReference = String((!compact && previewChampion) || liveChampion?.id || snapshot?.champion.id || "");

  useEffect(() => {
    if (externalSnapshot !== undefined) return;
    const source = new EventSource("/api/lcu/status");
    source.addEventListener("state", (event) => setStreamSnapshot(JSON.parse((event as MessageEvent<string>).data) as GameStateSnapshot));
    return () => source.close();
  }, [externalSnapshot]);

  useEffect(() => {
    rootRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  useEffect(() => {
    if (!championReference) return;
    const controller = new AbortController();
    void fetch(`/api/champ-select/recommendations?champion=${encodeURIComponent(championReference)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ChampSelectRecommendation | { error: string };
        if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Recommendation failed.");
        return payload;
      })
      .then((payload) => { setRecommendation(payload); setError(""); })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [championReference]);

  const topBuild = recommendation?.extremeBuilds[0];
  const chosenPreview = useMemo(() => champions.find((champion) => String(champion.id) === previewChampion), [champions, previewChampion]);

  if (!championReference || !recommendation) {
    return <section ref={rootRef} className={`champ-select-assistant ${compact ? "compact" : ""}`}>
      <div className="champ-assistant-empty"><span>{snapshot?.phase === "champ_select" ? "Waiting for your hover…" : "Champion Select assistant armed"}</span><p>Hover or lock a champion in Arena to load local builds automatically.</p>{!compact && <label>Preview<select aria-label="Preview champion" value={previewChampion} onChange={(event) => setPreviewChampion(event.target.value)}><option value="">Choose a champion…</option>{champions.map((champion) => <option value={champion.id} key={champion.id}>{champion.name}</option>)}</select></label>}{chosenPreview && <small>Loading {chosenPreview.name}…</small>}{error && <small>{error}</small>}</div>
    </section>;
  }

  return <section ref={rootRef} className={`champ-select-assistant ${compact ? "compact" : ""}`}>
    <div className="champ-assistant-title"><div><span>{snapshot?.phase === "champ_select" ? "Live Arena hover / lock" : "Champion build preview"}</span><strong>{recommendation.champion.name}</strong></div>{recommendation.meta && <b>{recommendation.meta.winRate?.toFixed(1)}% · {recommendation.meta.tier}</b>}</div>
    {!compact && <div className="champ-assistant-preview"><label>Preview another champion<select aria-label="Preview champion" value={previewChampion} onChange={(event) => setPreviewChampion(event.target.value)}><option value="">Use live selection</option>{champions.map((champion) => <option value={champion.id} key={champion.id}>{champion.name}</option>)}</select></label></div>}

    <div className="champ-assistant-section"><div className="overlay-section-title"><span>Duo synergy</span><b>Local matches</b></div><div className="champ-duos">{recommendation.duoRecommendations.slice(0, compact ? 3 : 4).map((duo) => <article key={duo.championKey}><Image src={duo.iconUrl} width={compact ? 28 : 38} height={compact ? 28 : 38} alt="" unoptimized /><div><strong>{duo.name}</strong><span>{duo.gamesTogether ? `${duo.gamesTogether} together · ${duo.winRate?.toFixed(1)}% 1st` : `${duo.fitTags.join("/")} · role fit`}</span></div></article>)}</div></div>

    <div className="champ-assistant-section"><div className="overlay-section-title"><span>Priority augments</span><b>Math + tier</b></div><div className="champ-picks">{recommendation.recommendedAugments.slice(0, compact ? 4 : 5).map((entity) => <article title={entity.reason} key={entity.entityKey}><Image src={entity.iconUrl} width={compact ? 25 : 34} height={compact ? 25 : 34} alt="" unoptimized /><div><strong>{entity.name}</strong><span>{entity.rarity}{entity.tier ? ` · ${entity.tier}` : ""}{entity.pickRate != null ? ` · ${entity.pickRate.toFixed(1)}% PR` : ""}</span></div></article>)}</div></div>

    <div className="champ-assistant-section"><div className="overlay-section-title"><span>Starting build anchors</span><b>Conversion paths</b></div><div className="champ-items">{recommendation.recommendedItems.map((entity) => <article title={entity.reason} key={entity.entityKey}><Image src={entity.iconUrl} width={compact ? 25 : 34} height={compact ? 25 : 34} alt="" unoptimized /><div><strong>{entity.name}</strong><span>{entity.reason}</span></div></article>)}</div></div>

    {topBuild && <div className="champ-extreme"><span>Extreme target · {topBuild.objective}</span><strong>{topBuild.augments.join(" → ")}</strong><div><b>{display(topBuild.stats.maxHealth)} HP</b><b>{display(topBuild.stats.totalAttackDamage, 1)} AD</b><b>{display(topBuild.stats.abilityPower, 1)} AP</b></div>{!compact && <Link href={`/extreme-builds`}>Browse every benchmark →</Link>}</div>}
    {!compact && <p className="champ-assistant-note">{recommendation.note}</p>}
    {error && <p className="overlay-error">{error}</p>}
  </section>;
}
