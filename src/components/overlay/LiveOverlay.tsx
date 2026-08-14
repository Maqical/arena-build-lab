"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChampSelectAssistant } from "@/components/overlay/ChampSelectAssistant";
import { ItemAssistant } from "@/components/overlay/ItemAssistant";
import { LiveGameHUD } from "@/components/overlay/LiveGameHUD";
import { LobbyScanner } from "@/components/overlay/LobbyScanner";
import { PostGameAnalysis } from "@/components/overlay/PostGameAnalysis";
import { PrismaticItemPicker } from "@/components/overlay/PrismaticItemPicker";
import { ScreenshotPickerControl } from "@/components/overlay/ScreenshotPickerControl";
import type { AIPickerResponse } from "@/lib/ai-picker-types";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";
import type { ArenaMetaRecord, LiveResolveResponse, OverlayCatalogEntity } from "@/lib/live-overlay-types";
import type { Champion } from "@/lib/types";

type ConnectionState = "connecting" | "live" | "retrying";

function normalized(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function display(value: number | undefined, digits = 0): string {
  if (value == null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload: unknown = await response.json();
  const serverError = payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error: unknown }).error)
    : "";
  if (!response.ok || serverError) throw new Error(serverError || `HTTP ${response.status}`);
  return payload as T;
}

function phaseLabel(snapshot: GameStateSnapshot | null): string {
  if (!snapshot) return "Finding League";
  if (snapshot.offeredItemRefs.length === 3) return "Choose a Prismatic item";
  const modeName = snapshot.mode === "aram_mayhem" ? "Mayhem" : "Arena";
  const labels: Record<GameStateSnapshot["phase"], string> = {
    disconnected: "League closed",
    idle: "Client ready",
    arena_lobby: `${modeName} queue`,
    champ_select: `${modeName} champion select`,
    augment_select: "Choose an augment",
    in_progress: `${modeName} live`,
    post_game: "Match complete",
  };
  return labels[snapshot.phase];
}

function demoSnapshot(entities: OverlayCatalogEntity[], champions: Champion[], phase: "augment_select" | "champ_select" | "in_progress" | "disconnected" = "augment_select", includeUncatalogued = false, showPrismaticOffers = false): GameStateSnapshot {
  const offered = ["Goliath", "Tank Engine", "Mind to Matter"].map((name) => entities.find((entity) => entity.name === name)?.entityKey ?? "").filter(Boolean);
  const offeredItems = ["Radiant Virtue", "Flesheater", "Pyromancer's Cloak"].map((name) => entities.find((entity) => entity.name === name)?.entityKey ?? "").filter(Boolean);
  const sion = champions.find((champion) => champion.key === "Sion");
  return {
    sequence: 1,
    connection: { state: phase === "disconnected" ? "retrying" : "connected", connected: phase !== "disconnected", lockfileSource: "demo", port: phase === "disconnected" ? null : 0, attempt: phase === "disconnected" ? 1 : 0, retryInMs: phase === "disconnected" ? 5_000 : null, lastError: phase === "disconnected" ? "League Client lockfile was not found." : "", updatedAt: new Date().toISOString() },
    phase,
    rawPhase: phase === "champ_select" ? "ChampSelect" : "InProgress",
    isArena: true,
    mode: "arena",
    supportsAugments: true,
    queueId: 1740,
    queueName: "Arena demo",
    champion: { id: phase === "disconnected" ? null : sion?.id ?? 14, name: phase === "disconnected" ? "" : "Sion", level: phase === "champ_select" ? 1 : 18 },
    lobbyMembers: [],
    currentEntityRefs: phase === "champ_select" || phase === "disconnected" ? [] : [entities.find((entity) => entity.name === "Overlord's Bloodmail")?.entityKey ?? "", ...(showPrismaticOffers ? [entities.find((entity) => entity.name === "Goliath")?.entityKey ?? ""] : []), ...(includeUncatalogued ? ["augment:999999"] : [])].filter(Boolean),
    offeredAugmentRefs: phase === "augment_select" && !showPrismaticOffers ? offered : [],
    offeredItemRefs: phase === "augment_select" && showPrismaticOffers ? offeredItems : [],
    liveStats: phase === "champ_select" || phase === "disconnected" ? null : { currentHealth: 11_400, maxHealth: 16_300, attackDamage: 630, abilityPower: 0, attackSpeed: 0.91, armor: 171, magicResistance: 103, moveSpeed: 345, abilityHaste: 25 },
    offerFeed: phase === "champ_select"
      ? { status: "waiting", sourceUri: "", detectedAt: "", note: "Champion Select demo.", observedCandidateUris: [] }
      : phase === "augment_select"
        ? { status: "detected", sourceUri: showPrismaticOffers ? "demo://prismatic-offers" : "demo://augment-offers", detectedAt: new Date().toISOString(), note: "Demo offer event.", observedCandidateUris: [] }
        : { status: "not_exposed", sourceUri: "", detectedAt: "", note: "Screenshot-picker demo.", observedCandidateUris: [] },
    updatedAt: new Date().toISOString(),
  };
}

export function LiveOverlay({ champions, entities, meta }: { champions: Champion[]; entities: OverlayCatalogEntity[]; meta: ArenaMetaRecord[] }) {
  const [snapshot, setSnapshot] = useState<GameStateSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [recommendation, setRecommendation] = useState<AIPickerResponse | null>(null);
  const [scannedAugmentKeys, setScannedAugmentKeys] = useState<string[]>([]);
  const [manualSelectionKey, setManualSelectionKey] = useState("");
  const [liveBuild, setLiveBuild] = useState<LiveResolveResponse | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(true);
  const [welcome] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("welcome") === "1");
  const [demoMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo"));
  const recommendationSignature = useRef("");
  const resolveSignature = useRef("");

  const entityLookup = useMemo(() => {
    const lookup = new Map<string, OverlayCatalogEntity>();
    for (const entity of entities) {
      for (const ref of [entity.entityKey, String(entity.numericId), `augment:${entity.numericId}`, `item:${entity.numericId}`, entity.apiName, entity.name]) {
        lookup.set(normalized(ref), entity);
      }
    }
    return lookup;
  }, [entities]);
  const metaLookup = useMemo(() => new Map(meta.map((record) => [record.entityKey, record])), [meta]);
  const offered = useMemo(
    () => (snapshot?.offeredAugmentRefs ?? [])
      .map((ref) => entityLookup.get(normalized(ref)))
      .filter((entity): entity is OverlayCatalogEntity => entity?.kind === "augment"),
    [entityLookup, snapshot?.offeredAugmentRefs],
  );
  const offeredItems = useMemo(
    () => (snapshot?.offeredItemRefs ?? [])
      .map((ref) => entityLookup.get(normalized(ref)))
      .filter((entity): entity is OverlayCatalogEntity => entity?.kind === "item"),
    [entityLookup, snapshot?.offeredItemRefs],
  );
  const detectedEntities = useMemo(
    () => (snapshot?.currentEntityRefs ?? [])
      .map((ref) => entityLookup.get(normalized(ref)))
      .filter((entity): entity is OverlayCatalogEntity => Boolean(entity)),
    [entityLookup, snapshot?.currentEntityRefs],
  );
  const currentEntities = useMemo(() => {
    const merged = new Map(detectedEntities.map((entity) => [entity.entityKey, entity]));
    for (const key of scannedAugmentKeys) {
      const entity = entityLookup.get(normalized(key));
      if (entity?.kind === "augment") merged.set(entity.entityKey, entity);
    }
    return [...merged.values()];
  }, [detectedEntities, entityLookup, scannedAugmentKeys]);
  const unresolvedAugmentRefs = useMemo(
    () => (snapshot?.currentEntityRefs ?? []).filter((ref) => !/^item:/i.test(ref) && !entityLookup.has(normalized(ref))),
    [entityLookup, snapshot?.currentEntityRefs],
  );
  const champion = useMemo(
    () => champions.find((candidate) => candidate.id === snapshot?.champion.id)
      ?? champions.find((candidate) => normalized(candidate.name) === normalized(snapshot?.champion.name ?? "")),
    [champions, snapshot?.champion],
  );
  const championMeta = champion ? metaLookup.get(`champion:${champion.key}`) : undefined;
  const championMetaPercent = championMeta?.winRate == null ? null : championMeta.sourceName === "riot_api_local" ? championMeta.winRate * 100 : championMeta.winRate;
  const confirmScannedPick = useCallback((entityKey: string) => {
    setScannedAugmentKeys((current) => [...new Set([...current, entityKey])]);
    setError("");
    if (demoMode) return;
    void postJson<{ ok: true; entityKey: string }>("/api/lcu/selection", { entityKey })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [demoMode]);
  const displayedOffers = useMemo(() => {
    if (offered.length > 0) return offered;
    if (!recommendation?.screenshotExtracted) return [];
    return recommendation.options
      .map((option) => entityLookup.get(normalized(option.entity.entityKey)))
      .filter((entity): entity is OverlayCatalogEntity => entity?.kind === "augment");
  }, [entityLookup, offered, recommendation]);
  const manualSelections = useMemo(
    () => entities
      .filter((entity) => entity.kind === "augment")
      .sort((left, right) => left.name.localeCompare(right.name)),
    [entities],
  );

  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo === "1" || demo === "prismatic" || demo === "champ-select" || demo === "screenshot" || demo === "disconnected" || demo === "uncatalogued") {
      const timer = window.setTimeout(() => {
        setSnapshot(demoSnapshot(entities, champions, demo === "champ-select" ? "champ_select" : demo === "screenshot" || demo === "uncatalogued" ? "in_progress" : demo === "disconnected" ? "disconnected" : "augment_select", demo === "uncatalogued", demo === "prismatic"));
        setConnectionState("live");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const source = new EventSource("/api/lcu/status");
    source.addEventListener("state", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as GameStateSnapshot;
      if (["disconnected", "idle", "post_game"].includes(next.phase)) setScannedAugmentKeys([]);
      setSnapshot(next);
      setConnectionState(next.connection.connected ? "live" : "retrying");
    });
    source.onopen = () => setConnectionState("live");
    source.onerror = () => setConnectionState("retrying");
    return () => source.close();
  }, [champions, entities]);

  useEffect(() => {
    if (!snapshot || !champion) return;
    const acceptedKeys = currentEntities.map((entity) => entity.entityKey).sort();
    const signature = `${champion.id}:${snapshot.champion.level}:${acceptedKeys.join(",")}`;
    if (resolveSignature.current === signature) return;
    resolveSignature.current = signature;
    void postJson<LiveResolveResponse>("/api/lcu/resolve", { championId: champion.id, level: snapshot.champion.level, currentEntityKeys: acceptedKeys })
      .then((result) => { setLiveBuild(result); setError(""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [champion, currentEntities, snapshot]);

  useEffect(() => {
    if (!snapshot || !champion || offered.length !== 3) return;
    const offeredKeys = offered.map((entity) => entity.entityKey);
    const currentKeys = currentEntities.map((entity) => entity.entityKey);
    const signature = `${champion.id}:${snapshot.champion.level}:${currentKeys.sort().join(",")}:${offeredKeys.join(",")}`;
    if (recommendationSignature.current === signature) return;
    recommendationSignature.current = signature;
    setRecommendation(null);
    void postJson<AIPickerResponse>("/api/ai-picker", {
      championId: champion.id,
      level: snapshot.champion.level,
      mode: snapshot.mode ?? "arena",
      currentEntityKeys: currentKeys,
      offeredAugmentKeys: offeredKeys,
      opponent: snapshot.mode === "aram_mayhem" ? "current ARAM: Mayhem lobby" : "current Arena lobby",
      useAI: true,
    }).then((result) => { setRecommendation(result); setError(""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [champion, currentEntities, offered, snapshot]);

  useEffect(() => {
    if (!recommendation?.screenshotExtracted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const option = recommendation.options[Number(event.key) - 1];
      if (!option) return;
      event.preventDefault();
      confirmScannedPick(option.entity.entityKey);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmScannedPick, recommendation]);

  const theory = liveBuild?.build.stats;
  const live = snapshot?.liveStats;
  return (
    <section className="live-overlay">
      <header className="overlay-status">
        <div><span className={`overlay-dot ${connectionState}`} /><div><strong>{phaseLabel(snapshot)}</strong><small>{snapshot?.supportsAugments ? snapshot.queueName || (snapshot.mode === "aram_mayhem" ? "ARAM: Mayhem detected" : "Arena detected") : snapshot?.connection.lastError || "Waiting for supported mode"}</small></div></div>
        <div className="overlay-status-actions"><b>{snapshot?.connection.connected ? "LCU" : "OFF"}</b><button type="button" className="overlay-eye" aria-label={visible ? "Hide overlay details" : "Show overlay details"} onClick={() => setVisible((current) => !current)}>{visible ? "◉" : "◌"}</button></div>
      </header>

      {welcome && <section className="overlay-welcome"><strong>Fetching latest Arena data…</strong><p>This only happens once. The overlay will switch to normal mode when initialization finishes.</p></section>}

      {snapshot?.phase === "disconnected" && <section className="overlay-connection-wait"><span className="overlay-wait-pulse" /><div><strong>Waiting for League Client…</strong><p>The overlay checks for League every five seconds and reconnects automatically.</p></div></section>}

      {!visible && <p className="overlay-hidden-note">Overlay details hidden <button type="button" onClick={() => setVisible(true)}>Show</button></p>}

      {visible && <>

      {snapshot?.phase !== "disconnected" && snapshot?.supportsAugments && <section className="overlay-champion">
        {champion ? <Image src={champion.iconUrl} alt="" width={42} height={42} unoptimized /> : <div className="overlay-champion-placeholder">?</div>}
        <div><span>Level {snapshot?.champion.level ?? 1}</span><h1>{champion?.name || snapshot?.champion.name || "No champion"}</h1></div>
        {championMeta && <a href={championMeta.sourceUrl} target="_blank" rel="noreferrer"><strong>{championMetaPercent?.toFixed(1)}%</strong><span>{championMeta.sourceName === "riot_api_local" ? `Local WR · ${championMeta.sampleSize ?? 0} games` : `Meta WR · ${championMeta.tier}`}</span></a>}
      </section>}

      {snapshot?.phase === "disconnected" ? null : !snapshot?.supportsAugments ? <section className="overlay-idle-state"><span className="overlay-wait-pulse" /><strong>Waiting for Arena or ARAM: Mayhem…</strong><p>Open a supported queue and this companion will switch views automatically.</p></section> : snapshot?.phase === "arena_lobby" ? <LobbyScanner snapshot={snapshot} /> : snapshot?.phase === "champ_select" ? <ChampSelectAssistant champions={champions} snapshot={snapshot} compact /> : snapshot?.phase === "in_progress" ? <>
        <LiveGameHUD snapshot={snapshot} build={liveBuild} augments={currentEntities.filter((entity) => entity.kind === "augment")} items={currentEntities.filter((entity) => entity.kind === "item")} unresolvedAugmentRefs={unresolvedAugmentRefs} />
        <ItemAssistant championId={champion?.id ?? snapshot.champion.id} augments={currentEntities.filter((entity) => entity.kind === "augment")} />
        {recommendation?.screenshotExtracted && <section className="overlay-offers screenshot-confirm"><div className="overlay-section-title"><span>Screenshot {snapshot.mode === "aram_mayhem" ? "cards" : "offers"}</span><b>Press 1 / 2 / 3 to confirm</b></div>{recommendation.options.map((option, index) => <button type="button" className={scannedAugmentKeys.includes(option.entity.entityKey) ? "confirmed" : ""} onClick={() => confirmScannedPick(option.entity.entityKey)} key={option.entity.entityKey}><span>{index + 1}</span><strong>{option.entity.name}</strong><small>{option.entity.entityKey === recommendation.recommendation.entityKey ? "Recommended" : "Mark chosen"}</small></button>)}<div className="overlay-verdict"><span>AI recommendation</span><strong>{recommendation.recommendation.name}</strong><p>{recommendation.recommendation.rationale}</p></div></section>}
      </> : snapshot?.phase === "post_game" ? <PostGameAnalysis championName={snapshot.champion.name} /> : offeredItems.length === 3 ? (
        <PrismaticItemPicker championId={champion?.id ?? snapshot.champion.id} level={snapshot.champion.level} currentEntityKeys={currentEntities.map((entity) => entity.entityKey)} offers={offeredItems} />
      ) : snapshot?.phase === "augment_select" || displayedOffers.length > 0 ? (
        <section className="overlay-offers">
          <div className="overlay-section-title"><span>{recommendation?.screenshotExtracted && offered.length === 0 ? "Screenshot offers" : "Auto-detected offers"}</span><b>{recommendation ? "Ranked" : "Analyzing…"}</b></div>
          {displayedOffers.map((entity, index) => {
            const result = recommendation?.options.find((option) => option.entity.entityKey === entity.entityKey);
            const augmentMeta = metaLookup.get(entity.entityKey);
            const recommended = recommendation?.recommendation.entityKey === entity.entityKey;
            const localMetaBadge = augmentMeta?.sourceName === "riot_api_local"
              ? augmentMeta.sampleSize != null && augmentMeta.sampleSize >= 20
                ? `${augmentMeta.winRate == null ? "—" : `${(augmentMeta.winRate * 100).toFixed(1)}%`} WR · Local Cohort: ${augmentMeta.sampleSize} games`
                : "Low Sample"
              : "";
            return <article className={recommended ? "best" : ""} key={entity.entityKey}>
              <Image src={entity.iconUrl} alt="" width={34} height={34} unoptimized />
              <div><span>{String.fromCharCode(65 + index)} · {entity.rarity}{augmentMeta && augmentMeta.sourceName !== "riot_api_local" ? ` · ${augmentMeta.tier} tier / ${augmentMeta.pickRate?.toFixed(1)}% PR` : ""}</span><strong>{entity.name}</strong>{localMetaBadge && <small className={`overlay-meta-badge ${localMetaBadge === "Low Sample" ? "low" : ""}`}>{localMetaBadge}</small>}</div>
              <dl><div><dt>HP</dt><dd>{result ? `${result.deltas.maxHealth >= 0 ? "+" : ""}${display(result.deltas.maxHealth)}` : "—"}</dd></div><div><dt>AD</dt><dd>{result ? `${result.deltas.totalAttackDamage >= 0 ? "+" : ""}${display(result.deltas.totalAttackDamage, 1)}` : "—"}</dd></div><div><dt>AP</dt><dd>{result ? `${result.deltas.abilityPower >= 0 ? "+" : ""}${display(result.deltas.abilityPower, 1)}` : "—"}</dd></div></dl>
            </article>;
          })}
          {recommendation && <div className="overlay-verdict"><span>{recommendation.provider === "openai" ? "AI pick" : "Mechanical pick"}</span><strong>{recommendation.recommendation.name}</strong><p>{recommendation.recommendation.rationale}</p></div>}
        </section>
      ) : (
        <section className="overlay-offer-wait">
          <span>{snapshot?.offerFeed.status === "not_exposed" ? "Offer feed unavailable" : "Augment watcher armed"}</span>
          <p>{snapshot?.offerFeed.note ?? "The overlay will populate when three offered IDs appear in a local client event."}</p>
        </section>
      )}

      {visible && snapshot?.supportsAugments && snapshot?.phase !== "disconnected" && snapshot?.phase !== "post_game" && <ScreenshotPickerControl
        championId={champion?.id ?? snapshot?.champion.id}
        level={snapshot?.champion.level ?? 18}
        currentEntityKeys={currentEntities.map((entity) => entity.entityKey)}
        mode={snapshot?.mode}
        onResult={(result) => {
          setRecommendation(result);
          setError("");
        }}
      />}

      {visible && snapshot?.supportsAugments && snapshot?.phase === "in_progress" && <details className="overlay-manual-selection">
        <summary>Card not detected? Add it manually</summary>
        <div><select value={manualSelectionKey} onChange={(event) => setManualSelectionKey(event.target.value)}><option value="">Select {snapshot.mode === "aram_mayhem" ? "Mayhem card" : "Arena augment"}…</option>{manualSelections.map((entity) => <option value={entity.entityKey} key={entity.entityKey}>{entity.name}</option>)}</select><button type="button" disabled={!manualSelectionKey} onClick={() => { confirmScannedPick(manualSelectionKey); setManualSelectionKey(""); }}>Add</button></div>
      </details>}

      {visible && snapshot?.supportsAugments && snapshot?.phase !== "disconnected" && snapshot?.phase !== "in_progress" && snapshot?.phase !== "post_game" && <section className="overlay-hud">
        <div className="overlay-section-title"><span>Live stat tracker</span><b>{live ? "Live + theory" : "Theoretical"}</b></div>
        <div className="overlay-stat-grid">
          <div><span>Max HP</span><strong>{display(theory?.maxHealth)}</strong>{live && <small>game {display(live.maxHealth)}</small>}</div>
          <div><span>AD</span><strong>{display(theory?.totalAttackDamage, 1)}</strong>{live && <small>game {display(live.attackDamage, 1)}</small>}</div>
          <div><span>AP</span><strong>{display(theory?.abilityPower, 1)}</strong>{live && <small>game {display(live.abilityPower, 1)}</small>}</div>
          <div><span>AS</span><strong>{display(theory?.attackSpeed, 2)}</strong>{live && <small>game {display(live.attackSpeed, 2)}</small>}</div>
        </div>
        <div className="craze-meter"><div><span>Craze Factor</span><strong>{liveBuild?.crazeFactor ?? 100}</strong></div><div className="craze-track"><i style={{ width: `${Math.min(100, (liveBuild?.crazeFactor ?? 100) / 5)}%` }} /></div><small>{liveBuild?.crazeLabel ?? "Baseline"} · resolver vs. level baseline</small></div>
      </section>}

      {currentEntities.length > 0 && <div className="overlay-owned">{currentEntities.slice(0, 8).map((entity) => <Image title={entity.name} src={entity.iconUrl} width={25} height={25} alt={entity.name} unoptimized key={entity.entityKey} />)}</div>}
      {visible && error && <p className="overlay-error">{error}</p>}
      </>}
      <footer><span>Local APIs only · no injection</span><a href="/overlay?demo=1">Demo</a></footer>
    </section>
  );
}
