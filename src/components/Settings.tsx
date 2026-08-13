"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Worker = "riot" | "youtube" | "data";
type PatchStatus = { localPatch: string; livePatch: string; stale: boolean; checkedAt: string; error?: string };

export function Settings() {
  const [riotApiKey, setRiotApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [opacity, setOpacity] = useState(100);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState("");
  const [workerStatus, setWorkerStatus] = useState("");
  const [workerBusy, setWorkerBusy] = useState<Worker | null>(null);
  const [patchStatus, setPatchStatus] = useState<PatchStatus | null>(null);
  const desktop = typeof window !== "undefined" && Boolean(window.arenaDesktop);

  const checkPatch = useCallback(async () => {
    try {
      const response = await fetch("/api/patch-status", { cache: "no-store" });
      setPatchStatus(await response.json() as PatchStatus);
    } catch { setPatchStatus(null); }
  }, []);
  useEffect(() => { void window.arenaDesktop?.getSettings().then((settings) => { setRiotApiKey(settings.riotApiKey); setOpenAiApiKey(settings.openAiApiKey); setOpacity(settings.opacity * 100); setScale(settings.scale); }); void Promise.resolve().then(checkPatch); }, [checkPatch]);
  const appearance = (nextOpacity = opacity, nextScale = scale) => { setOpacity(nextOpacity); setScale(nextScale); void window.arenaDesktop?.applyAppearance({ opacity: nextOpacity / 100, scale: nextScale }); };
  const save = async () => { setStatus("Saving…"); const result = await window.arenaDesktop?.saveSettings({ riotApiKey, openAiApiKey, opacity: opacity / 100, scale }); setStatus(result?.ok ? "Saved locally. API services restarted with the new keys." : result?.error ?? "Open this page in the desktop app to save settings."); };
  const runWorker = async (worker: Worker) => {
    const label = worker === "riot" ? "Riot match" : worker === "youtube" ? "YouTube catalog" : "Data Dragon";
    setWorkerBusy(worker);
    setWorkerStatus(`Running ${label} sync…`);
    try {
      const result = await window.arenaDesktop?.runWorker(worker);
      setWorkerStatus(result?.message ?? "Desktop worker controls are unavailable in a browser.");
      if (worker === "data" && result?.ok) await checkPatch();
    } finally { setWorkerBusy(null); }
  };
  return <main className="settings-shell"><header className="collection-header"><div><span className="eyebrow">Desktop companion</span><h1>Settings</h1><p>Keys stay in the app&apos;s local user data folder and never render in the UI.</p></div><nav><Link href="/overlay">Overlay</Link><Link href="/">Build Lab</Link></nav></header>
    {!desktop && <div className="settings-warning">Open this route from the Arena Build Lab desktop app to save secrets or run workers.</div>}
    {patchStatus?.stale && <button className="settings-patch-warning" type="button" onClick={() => void runWorker("data")} disabled={!desktop || workerBusy !== null}><strong>New League patch {patchStatus.livePatch} detected</strong><span>Your local data is {patchStatus.localPatch || "not synced"}. Click to sync the latest Data Dragon stats.</span></button>}
    <section className="settings-card"><h2>API connections</h2><label>Riot API key<input type="password" value={riotApiKey} onChange={(event) => setRiotApiKey(event.target.value)} placeholder="RGAPI-…" autoComplete="off" /></label><label>OpenAI API key<input type="password" value={openAiApiKey} onChange={(event) => setOpenAiApiKey(event.target.value)} placeholder="sk-…" autoComplete="off" /></label><button className="settings-primary" type="button" onClick={() => void save()} disabled={!desktop}>Save settings</button>{status && <p className="settings-status">{status}</p>}</section>
    <section className="settings-card"><h2>Overlay appearance</h2><label>Opacity <output>{Math.round(opacity)}%</output><input type="range" min="0" max="100" value={opacity} onChange={(event) => appearance(Number(event.target.value), scale)} /></label><label>Scale <output>{scale.toFixed(2)}×</output><input type="range" min="0.75" max="1.5" step="0.05" value={scale} onChange={(event) => appearance(opacity, Number(event.target.value))} /></label></section>
    <section className="settings-card"><h2>Data workers</h2><p>Run a read-only sync in the background. Progress is written to the local database.</p><div className="settings-actions"><button type="button" onClick={() => void runWorker("riot")} disabled={!desktop || workerBusy !== null}>{workerBusy === "riot" ? "Syncing…" : "Sync Riot Matches"}</button><button type="button" onClick={() => void runWorker("youtube")} disabled={!desktop || workerBusy !== null}>{workerBusy === "youtube" ? "Syncing…" : "Sync YouTube Catalog"}</button><button type="button" onClick={() => void runWorker("data")} disabled={!desktop || workerBusy !== null}>{workerBusy === "data" ? "Syncing…" : "Sync Data Dragon"}</button></div>{workerStatus && <p className="settings-status">{workerStatus}</p>}{patchStatus?.error && <p className="settings-status">Patch check unavailable: {patchStatus.error}</p>}</section>
    <section className="settings-card"><h2>Updates</h2><p>Release updates are checked through the desktop shell when configured.</p><button type="button" onClick={() => void window.arenaDesktop?.checkForUpdates()}>Check for updates</button></section>
  </main>;
}
