"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { OverlayCatalogEntity } from "@/lib/live-overlay-types";

type ConditionalResponse = {
  augmentIds: number[];
  augmentNames: string[];
  sampleSize: number;
  lowSample: boolean;
  source: "observed" | "extreme" | "none";
  message: string;
  items: Array<{ entityKey: string; name: string; iconUrl: string; games: number; pickRate: number; reason: string }>;
};

export function ItemAssistant({ championId, augments }: { championId: number | null; augments: OverlayCatalogEntity[] }) {
  const [conditional, setConditional] = useState<ConditionalResponse | null>(null);

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
  const active = championId && selectedAugmentIds.length > 0 && selectedAugmentIds.join(",") === responseAugmentIds.join(",") ? conditional : null;
  return <section className="item-assistant">
    <div className="overlay-section-title">
      <span>{active?.augmentNames.length ? `Buys with ${active.augmentNames.join(" + ")}` : "Champion-specific buys"}</span>
      <b>{active?.source === "observed" ? `${active.sampleSize} games` : active?.source === "extreme" ? "Mechanical" : "Localized only"}</b>
    </div>
    {(active?.items.length ?? 0) > 0
      ? <div className="item-buy-list">{active?.items.map((item) => <div key={item.entityKey}>{item.iconUrl ? <Image src={item.iconUrl} width={34} height={34} alt="" unoptimized /> : null}<span><strong>{item.name}</strong><small>{active.source === "observed" ? `${(item.pickRate * 100).toFixed(0)}% pick · ${item.games} matching games` : item.reason}</small></span><em>{active.source === "observed" ? "Observed" : "Extreme"}</em></div>)}</div>
      : <p className="overlay-muted">{active?.message ?? (augments.length === 0 ? "Scan or select an augment for champion-specific recommendations." : "Checking localized item paths…")}</p>}
  </section>;
}
