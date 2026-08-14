"use client";

import { useEffect, useState } from "react";
import type { PostGameAnalysisResult } from "@/lib/post-game-analysis";

export function PostGameAnalysis({ championName }: { championName: string }) {
  const [analysis, setAnalysis] = useState<PostGameAnalysisResult | null>(null);
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/post-game-analysis?champion=${encodeURIComponent(championName)}`, { signal: controller.signal, cache: "no-store" }).then((response) => response.json()).then((value: { analysis: PostGameAnalysisResult | null }) => setAnalysis(value.analysis)).catch(() => undefined); return () => controller.abort(); }, [championName]);
  if (!analysis) return <section className="overlay-post-game"><div className="overlay-section-title"><span>Match complete</span><b>Saving peaks…</b></div><p>Your final local observation is being recorded.</p></section>;
  const best = analysis.suggested[0];
  return <section className="overlay-post-game"><div className="overlay-section-title"><span>Post-game analysis</span><b>{analysis.personalRecord ? "New record" : "Recorded"}</b></div><div className="post-game-grade"><strong>{analysis.grade}</strong><span>{analysis.score == null ? "Match grade pending sync" : `${analysis.score.toFixed(0)} / 100 performance`}</span></div><strong>{analysis.championName}</strong><div className="post-game-peaks"><span>{analysis.peakHp.toLocaleString()} HP</span><span>{analysis.peakAd.toLocaleString()} AD</span><span>{analysis.peakAp.toLocaleString()} AP</span></div><p>{best ? `You picked ${analysis.picked.join(", ") || "unrecorded augments"}. Your local cohort's top option is ${best.name} (${(best.firstPlaceRate * 100).toFixed(1)}% first-place, ${best.sampleSize} games).` : "Run local meta calculation after syncing matches to compare your choices."}</p><a href="/trophies">Open Trophy Case</a></section>;
}
