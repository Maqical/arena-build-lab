"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Worker = "riot" | "youtube" | "data";
type PatchStatus = { localPatch: string; livePatch: string; stale: boolean; checkedAt: string; error?: string };

export function Settings() {
  const [riotId, setRiotId] = useState("");
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

  useEffect(() => {
    void window.arenaDesktop?.getSettings().then((settings) => {
      setRiotId(settings.riotId);
      setRiotApiKey(settings.riotApiKey);
      setOpenAiApiKey(settings.openAiApiKey);
      setOpacity(settings.opacity * 100);
      setScale(settings.scale);
    });
    void Promise.resolve().then(checkPatch);
  }, [checkPatch]);

  const appearance = (nextOpacity = opacity, nextScale = scale) => {
    setOpacity(nextOpacity); setScale(nextScale);
    void window.arenaDesktop?.applyAppearance({ opacity: nextOpacity / 100, scale: nextScale });
  };
  const save = async () => {
    setStatus("Saving…");
    const result = await window.arenaDesktop?.saveSettings({ riotId, riotApiKey, openAiApiKey, opacity: opacity / 100, scale });
    setStatus(result?.ok ? "Saved locally. API services restarted with the new settings." : result?.error ?? "Open this page in the desktop app to save settings.");
  };
  const runWorker = async (worker: Worker) => {
    const label = worker === "riot" ? "Riot match" : worker === "youtube" ? "Video catalog" : "Data Dragon";
    setWorkerBusy(worker); setWorkerStatus(`Running ${label} sync…`);
    try {
      const result = await window.arenaDesktop?.runWorker(worker);
      setWorkerStatus(result?.message ?? "Desktop worker controls are unavailable in a browser.");
      if (worker === "data" && result?.ok) await checkPatch();
    } finally { setWorkerBusy(null); }
  };

  return <main className="settings-shell">
    <header className="collection-header"><div><span className="eyebrow">Desktop companion</span><h1>Settings</h1><p>Account details and API keys stay in the app&apos;s local user-data folder and never render back into the interface.</p></div><nav><Link href="/live">Live view</Link><Link href="/build-lab">Build Lab</Link></nav></header>
    {!desktop && <div className="settings-warning">Open this route from the desktop app to save secrets or run local workers.</div>}
    {patchStatus?.stale && <button className="settings-patch-warning" type="button" onClick={() => void runWorker("data")} disabled={!desktop || workerBusy !== null}><strong>New League patch {patchStatus.livePatch} detected</strong><span>Your local data is {patchStatus.localPatch || "not synced"}. Click to sync the latest game data.</span></button>}
    <section className="settings-card"><h2>Account & API connections</h2><label>Riot ID<input type="text" value={riotId} onChange={(event) => setRiotId(event.target.value)} placeholder="GameName#Tag" autoComplete="off" /></label><p>Your Riot ID seeds the personal match warehouse when you run a Riot match sync.</p><label>Riot API key<input type="password" value={riotApiKey} onChange={(event) => setRiotApiKey(event.target.value)} placeholder="RGAPI-…" autoComplete="off" /></label><label>OpenAI API key<input type="password" value={openAiApiKey} onChange={(event) => setOpenAiApiKey(event.target.value)} placeholder="sk-…" autoComplete="off" /></label><button className="settings-primary" type="button" onClick={() => void save()} disabled={!desktop}>Save settings</button>{status && <p className="settings-status">{status}</p>}</section>
    <section className="settings-card"><h2>Overlay appearance</h2><label>Opacity <output>{Math.round(opacity)}%</output><input type="range" min="0" max="100" value={opacity} onChange={(event) => appearance(Number(event.target.value), scale)} /></label><label>Scale <output>{scale.toFixed(2)}×</output><input type="range" min="0.75" max="1.5" step="0.05" value={scale} onChange={(event) => appearance(opacity, Number(event.target.value))} /></label><div className="settings-actions"><button type="button" onClick={() => void window.arenaDesktop?.openOverlay()} disabled={!desktop}>Open overlay window</button></div></section>
    <section className="settings-card"><h2>Data management</h2><p>Run a read-only sync in the background. Progress is written to the local database.</p><div className="settings-actions"><button type="button" onClick={() => void runWorker("riot")} disabled={!desktop || workerBusy !== null}>{workerBusy === "riot" ? "Syncing…" : "Sync Riot Matches"}</button><button type="button" onClick={() => void runWorker("youtube")} disabled={!desktop || workerBusy !== null}>{workerBusy === "youtube" ? "Syncing…" : "Sync Video Catalog"}</button><button type="button" onClick={() => void runWorker("data")} disabled={!desktop || workerBusy !== null}>{workerBusy === "data" ? "Syncing…" : "Sync Game Data"}</button></div>{workerStatus && <p className="settings-status">{workerStatus}</p>}{patchStatus?.error && <p className="settings-status">Patch check unavailable: {patchStatus.error}</p>}</section>
    <section className="settings-card"><div className="settings-about-heading"><h2>Updates & about</h2><span className="settings-version">v1.0.2</span></div><p>Arena Build Lab runs locally and reads the supported local client surfaces without game injection.</p><button type="button" onClick={() => void window.arenaDesktop?.checkForUpdates()}>Check for updates</button></section>
  </main>;
}
