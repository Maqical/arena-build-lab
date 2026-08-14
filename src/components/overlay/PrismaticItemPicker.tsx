"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { OverlayCatalogEntity } from "@/lib/live-overlay-types";

type PickerResponse = {
  sampleSize: number;
  source: string;
  message: string;
  recommendation: { entityKey: string; name: string; rationale: string };
  options: Array<{
    entity: { entityKey: string; numericId: number; name: string; iconUrl: string };
    deltas: Record<"health" | "attackDamage" | "abilityPower" | "attackSpeed" | "armor" | "magicResistance" | "haste" | "moveSpeed", number>;
    observed: { pickRate: number; games: number; source: string } | null;
    nextItems: Array<{ entityKey: string; name: string; iconUrl: string }>;
  }>;
};

const LABELS: Record<keyof PickerResponse["options"][number]["deltas"], string> = { health: "HP", attackDamage: "AD", abilityPower: "AP", attackSpeed: "AS", armor: "Armor", magicResistance: "MR", haste: "Haste", moveSpeed: "MS" };

export function PrismaticItemPicker({ championId, level, currentEntityKeys, offers }: { championId: number | null; level: number; currentEntityKeys: string[]; offers: OverlayCatalogEntity[] }) {
  const [result, setResult] = useState<PickerResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!championId || offers.length !== 3) return;
    const controller = new AbortController();
    void fetch("/api/prismatic-picker", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ championId, level, currentEntityKeys, offeredItemKeys: offers.map((offer) => offer.entityKey) }) })
      .then(async (response) => { const payload = await response.json() as PickerResponse | { error: string }; if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Prismatic comparison failed."); return payload; })
      .then((payload) => { setResult(payload); setError(""); })
      .catch((caught: unknown) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [championId, currentEntityKeys, level, offers]);

  return <section className="overlay-offers prismatic-picker">
    <div className="overlay-section-title"><span>Prismatic item choice</span><b>{result ? result.sampleSize > 0 ? `${result.sampleSize} matching games` : "Mechanical path" : "Analyzing…"}</b></div>
    {offers.map((offer) => {
      const option = result?.options.find((candidate) => candidate.entity.entityKey === offer.entityKey);
      const recommended = result?.recommendation.entityKey === offer.entityKey;
      const deltas = option ? Object.entries(option.deltas).filter(([, value]) => Math.abs(value) >= 0.01).sort((left, right) => Math.abs(right[1]) - Math.abs(left[1])).slice(0, 4) as Array<[keyof typeof option.deltas, number]> : [];
      return <article className={recommended ? "best" : ""} key={offer.entityKey}>
        <div className="prismatic-item-heading"><Image src={offer.iconUrl} width={42} height={42} alt="" unoptimized /><div><strong>{offer.name}</strong><small>{recommended ? "Recommended" : option?.observed ? `${(option.observed.pickRate * 100).toFixed(0)}% cohort pick` : "Live comparison"}</small></div></div>
        <div className="prismatic-deltas">{deltas.map(([key, value]) => <span key={key}>{LABELS[key]} {value > 0 ? "+" : ""}{key === "attackSpeed" ? value.toFixed(2) : Math.round(value).toLocaleString()}</span>)}</div>
        <p className="prismatic-path"><b>Continue:</b> {option?.nextItems.length ? option.nextItems.map((item) => item.name).join(" → ") : "No champion-specific continuation is recorded yet."}</p>
      </article>;
    })}
    {result && <div className="overlay-verdict"><span>Recommended path</span><strong>{result.recommendation.name}</strong><p>{result.recommendation.rationale}</p><small className="prismatic-source-note">{result.message}</small></div>}
    {error && <p className="overlay-error">{error}</p>}
  </section>;
}
