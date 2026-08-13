"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Worker = "riot" | "youtube";

export function Settings() {
  const [riotApiKey, setRiotApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [opacity, setOpacity] = useState(100);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState("");
  const [workerStatus, setWorkerStatus] = useState("");
  const desktop = typeof window !== "undefined" && Boolean(window.arenaDesktop);

  useEffect(() => { void window.arenaDesktop?.getSettings().then((settings) => { setRiotApiKey(settings.riotApiKey); setOpenAiApiKey(settings.openAiApiKey); setOpacity(settings.opacity * 100); setScale(settings.scale); }); }, []);
  const appearance = (nextOpacity = opacity, nextScale = scale) => { setOpacity(nextOpacity); setScale(nextScale); void window.arenaDesktop?.applyAppearance({ opacity: nextOpacity / 100, scale: nextScale }); };
  const save = async () => { setStatus("Saving…"); const result = await window.arenaDesktop?.saveSettings({ riotApiKey, openAiApiKey, opacity: opacity / 100, scale }); setStatus(result?.ok ? "Saved locally. API services restarted with the new keys." : result?.error ?? "Open this page in the desktop app to save settings."); };
  const runWorker = async (worker: Worker) => { setWorkerStatus(`Starting ${worker === "riot" ? "Riot match" : "YouTube catalog"} sync…`); const result = await window.arenaDesktop?.runWorker(worker); setWorkerStatus(result?.message ?? "Desktop worker controls are unavailable in a browser."); };
  return <main className="settings-shell"><header className="collection-header"><div><span className="eyebrow">Desktop companion</span><h1>Settings</h1><p>Keys stay in the app&apos;s local user data folder and never render in the UI.</p></div><nav><Link href="/overlay">Overlay</Link><Link href="/">Build Lab</Link></nav></header>
    {!desktop && <div className="settings-warning">Open this route from the Arena Build Lab desktop app to save secrets or run workers.</div>}
    <section className="settings-card"><h2>API connections</h2><label>Riot API key<input type="password" value={riotApiKey} onChange={(event) => setRiotApiKey(event.target.value)} placeholder="RGAPI-…" autoComplete="off" /></label><label>OpenAI API key<input type="password" value={openAiApiKey} onChange={(event) => setOpenAiApiKey(event.target.value)} placeholder="sk-…" autoComplete="off" /></label><button className="settings-primary" type="button" onClick={() => void save()} disabled={!desktop}>Save settings</button>{status && <p className="settings-status">{status}</p>}</section>
    <section className="settings-card"><h2>Overlay appearance</h2><label>Opacity <output>{Math.round(opacity)}%</output><input type="range" min="0" max="100" value={opacity} onChange={(event) => appearance(Number(event.target.value), scale)} /></label><label>Scale <output>{scale.toFixed(2)}×</output><input type="range" min="0.75" max="1.5" step="0.05" value={scale} onChange={(event) => appearance(opacity, Number(event.target.value))} /></label></section>
    <section className="settings-card"><h2>Data workers</h2><p>Run a read-only sync in the background. Progress is written to the local database.</p><div className="settings-actions"><button type="button" onClick={() => void runWorker("riot")} disabled={!desktop}>Sync Riot Matches</button><button type="button" onClick={() => void runWorker("youtube")} disabled={!desktop}>Sync YouTube Catalog</button></div>{workerStatus && <p className="settings-status">{workerStatus}</p>}</section>
    <section className="settings-card"><h2>Updates</h2><p>Release updates are checked through the desktop shell when configured.</p><button type="button" onClick={() => void window.arenaDesktop?.checkForUpdates()}>Check for updates</button></section>
  </main>;
}
