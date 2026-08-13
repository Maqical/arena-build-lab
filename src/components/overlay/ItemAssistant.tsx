"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ChampSelectRecommendation } from "@/lib/champ-select-types";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";
import type { OverlayCatalogEntity } from "@/lib/live-overlay-types";

type ConditionalResponse = {
  augmentIds: number[];
  augmentNames: string[];
  sampleSize: number;
  lowSample: boolean;
  items: Array<{ entityKey: string; name: string; iconUrl: string; games: number; pickRate: number }>;
};

export function ItemAssistant({ snapshot, championId, augments }: { snapshot: GameStateSnapshot; championId: number | null; augments: OverlayCatalogEntity[] }) {
  const [recommendation, setRecommendation] = useState<ChampSelectRecommendation | null>(null);
  const [conditional, setConditional] = useState<ConditionalResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!snapshot.champion.name) return;
    const controller = new AbortController();
    void fetch(`/api/champ-select/recommendations?champion=${encodeURIComponent(snapshot.champion.name)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<ChampSelectRecommendation> : Promise.reject(new Error("recommendations unavailable")))
      .then((result) => { setRecommendation(result); setFailed(false); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true); });
    return () => controller.abort();
  }, [snapshot.champion.name]);

  useEffect(() => {
    const augmentIds = augments.map((augment) => augment.numericId).filter((id) => id > 0);
    if (!championId || augmentIds.length === 0) return;
    const controller = new AbortController();
    void fetch(`/api/augment-builds?championId=${championId}&augmentIds=${augmentIds.join(",")}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<ConditionalResponse> : Promise.reject(new Error("conditional builds unavailable")))
      .then(setConditional)
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setConditional(null); });
    return () => controller.abort();
  }, [augments, championId]);

  const selectedAugmentIds = augments.map((augment) => augment.numericId).filter((id) => id > 0).sort((left, right) => left - right);
  const responseAugmentIds = [...(conditional?.augmentIds ?? [])].sort((left, right) => left - right);
  const activeConditional = championId && selectedAugmentIds.length > 0 && selectedAugmentIds.join(",") === responseAugmentIds.join(",") ? conditional : null;
  const conditionalItems = activeConditional?.items ?? [];
  const fallbackItems = recommendation?.recommendedItems ?? [];
  return <section className="item-assistant">
    <div className="overlay-section-title">
      <span>{activeConditional?.augmentNames.length ? `Buys with ${activeConditional.augmentNames.join(" + ")}` : "Recommended buys"}</span>
      <b>{activeConditional ? activeConditional.lowSample ? "Low sample" : `${activeConditional.sampleSize} games` : fallbackItems.length ? "Local paths" : "Loading"}</b>
    </div>
    {conditionalItems.length > 0
      ? <div className="item-buy-list">{conditionalItems.map((item) => <div key={item.entityKey}>{item.iconUrl ? <Image src={item.iconUrl} width={30} height={30} alt="" unoptimized /> : null}<span><strong>{item.name}</strong><small>{(item.pickRate * 100).toFixed(0)}% pick · {item.games} matching games</small></span><em title="Observed in the local Riot match cohort">Observed</em></div>)}</div>
      : fallbackItems.length > 0
        ? <div className="item-buy-list">{fallbackItems.map((item) => <div key={item.entityKey}><Image src={item.iconUrl} width={30} height={30} alt="" unoptimized /><span><strong>{item.name}</strong><small>{item.reason}</small></span><em title="No populated champion + augment cohort yet">Fallback</em></div>)}</div>
        : <p className="overlay-muted">{failed ? "No local item path found for this champion." : "Matching local item paths…"}</p>}
  </section>;
}
