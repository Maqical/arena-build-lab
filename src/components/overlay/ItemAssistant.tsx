"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ChampSelectRecommendation } from "@/lib/champ-select-types";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";

export function ItemAssistant({ snapshot }: { snapshot: GameStateSnapshot }) {
  const [recommendation, setRecommendation] = useState<ChampSelectRecommendation | null>(null);
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
  const items = recommendation?.recommendedItems ?? [];
  return <section className="item-assistant"><div className="overlay-section-title"><span>Recommended buys</span><b>{items.length ? "Local paths" : "Loading"}</b></div>
    {items.length > 0 ? <div className="item-buy-list">{items.map((item) => <div key={item.entityKey}><Image src={item.iconUrl} width={30} height={30} alt="" unoptimized /><span><strong>{item.name}</strong><small>{item.reason}</small></span><em title="Live Client Data does not expose reliable Arena shop gold here">Gold unavailable</em></div>)}</div> : <p className="overlay-muted">{failed ? "No local item path found for this champion." : "Matching extreme-build item paths…"}</p>}
  </section>;
}
