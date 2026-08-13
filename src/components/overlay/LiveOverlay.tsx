"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChampSelectAssistant } from "@/components/overlay/ChampSelectAssistant";
import { ItemAssistant } from "@/components/overlay/ItemAssistant";
import { LiveGameHUD } from "@/components/overlay/LiveGameHUD";
import { LobbyScanner } from "@/components/overlay/LobbyScanner";
import { PostGameAnalysis } from "@/components/overlay/PostGameAnalysis";
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
  const labels: Record<GameStateSnapshot["phase"], string> = {
    disconnected: "League closed",
    idle: "Client ready",
    arena_lobby: "Arena queue",
    champ_select: "Arena champion select",
    augment_select: "Choose an augment",
    in_progress: "Arena live",
    post_game: "Match complete",
  };
  return labels[snapshot.phase];
}

function demoSnapshot(entities: OverlayCatalogEntity[], champions: Champion[], phase: "augment_select" | "champ_select" | "in_progress" | "disconnected" = "augment_select"): GameStateSnapshot {
  const offered = ["Goliath", "Tank Engine", "Mind to Matter"].map((name) => entities.find((entity) => entity.name === name)?.entityKey ?? "").filter(Boolean);
  const sion = champions.find((champion) => champion.key === "Sion");
  return {
    sequence: 1,
    connection: { state: phase === "disconnected" ? "retrying" : "connected", connected: phase !== "disconnected", lockfileSource: "demo", port: phase === "disconnected" ? null : 0, attempt: phase === "disconnected" ? 1 : 0, retryInMs: phase === "disconnected" ? 5_000 : null, lastError: phase === "disconnected" ? "League Client lockfile was not found." : "", updatedAt: new Date().toISOString() },
    phase,
    rawPhase: phase === "champ_select" ? "ChampSelect" : "InProgress",
    isArena: true,
    queueId: 1740,
    queueName: "Arena demo",
    champion: { id: phase === "disconnected" ? null : sion?.id ?? 14, name: phase === "disconnected" ? "" : "Sion", level: phase === "champ_select" ? 1 : 18 },
    lobbyMembers: [],
    currentEntityRefs: phase === "champ_select" || phase === "disconnected" ? [] : [entities.find((entity) => entity.name === "Overlord's Bloodmail")?.entityKey ?? ""].filter(Boolean),
    offeredAugmentRefs: phase === "augment_select" ? offered : [],
    liveStats: phase === "champ_select" || phase === "disconnected" ? null : { currentHealth: 11_400, maxHealth: 16_300, attackDamage: 630, abilityPower: 0, attackSpeed: 0.91, armor: 171, magicResistance: 103, moveSpeed: 345, abilityHaste: 25 },
    offerFeed: phase === "champ_select"
      ? { status: "waiting", sourceUri: "", detectedAt: "", note: "Champion Select demo.", observedCandidateUris: [] }
      : phase === "augment_select"
        ? { status: "detected", sourceUri: "demo://augment-offers", detectedAt: new Date().toISOString(), note: "Demo offer event.", observedCandidateUris: [] }
        : { status: "not_exposed", sourceUri: "", detectedAt: "", note: "Screenshot-picker demo.", observedCandidateUris: [] },
    updatedAt: new Date().toISOString(),
  };
}

export function LiveOverlay({ champions, entities, meta }: { champions: Champion[]; entities: OverlayCatalogEntity[]; meta: ArenaMetaRecord[] }) {
  const [snapshot, setSnapshot] = useState<GameStateSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [recommendation, setRecommendation] = useState<AIPickerResponse | null>(null);
  const [liveBuild, setLiveBuild] = useState<LiveResolveResponse | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(true);
  const [welcome] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("welcome") === "1");
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
  const currentEntities = useMemo(
    () => (snapshot?.currentEntityRefs ?? [])
      .map((ref) => entityLookup.get(normalized(ref)))
      .filter((entity): entity is OverlayCatalogEntity => Boolean(entity)),
    [entityLookup, snapshot?.currentEntityRefs],
  );
  const champion = useMemo(
    () => champions.find((candidate) => candidate.id === snapshot?.champion.id)
      ?? champions.find((candidate) => normalized(candidate.name) === normalized(snapshot?.champion.name ?? "")),
    [champions, snapshot?.champion.id, snapshot?.champion.name],
  );
  const championMeta = champion ? metaLookup.get(`champion:${champion.key}`) : undefined;
  const championMetaPercent = championMeta?.winRate == null ? null : championMeta.sourceName === "riot_api_local" ? championMeta.winRate * 100 : championMeta.winRate;
  const displayedOffers = useMemo(() => {
    if (offered.length > 0) return offered;
    if (!recommendation?.screenshotExtracted) return [];
    return recommendation.options
      .map((option) => entityLookup.get(normalized(option.entity.entityKey)))
      .filter((entity): entity is OverlayCatalogEntity => entity?.kind === "augment");
  }, [entityLookup, offered, recommendation]);

  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo === "1" || demo === "champ-select" || demo === "screenshot" || demo === "disconnected") {
      const timer = window.setTimeout(() => {
        setSnapshot(demoSnapshot(entities, champions, demo === "champ-select" ? "champ_select" : demo === "screenshot" ? "in_progress" : demo === "disconnected" ? "disconnected" : "augment_select"));
        setConnectionState("live");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const source = new EventSource("/api/lcu/status");
    source.addEventListener("state", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as GameStateSnapshot;
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
      currentEntityKeys: currentKeys,
      offeredAugmentKeys: offeredKeys,
      opponent: "current Arena lobby",
      useAI: true,
    }).then((result) => { setRecommendation(result); setError(""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [champion, currentEntities, offered, snapshot]);

  const theory = liveBuild?.build.stats;
  const live = snapshot?.liveStats;
  return (
    <section className="live-overlay">
      <header className="overlay-status">
        <div><span className={`overlay-dot ${connectionState}`} /><div><strong>{phaseLabel(snapshot)}</strong><small>{snapshot?.isArena ? snapshot.queueName || "Arena detected" : snapshot?.connection.lastError || "Waiting for local client"}</small></div></div>
        <div className="overlay-status-actions"><b>{snapshot?.connection.connected ? "LCU" : "OFF"}</b><button type="button" className="overlay-eye" aria-label={visible ? "Hide overlay details" : "Show overlay details"} onClick={() => setVisible((current) => !current)}>{visible ? "◉" : "◌"}</button></div>
      </header>

      {welcome && <section className="overlay-welcome"><strong>Fetching latest Arena data…</strong><p>This only happens once. The overlay will switch to normal mode when initialization finishes.</p></section>}

      {snapshot?.phase === "disconnected" && <section className="overlay-connection-wait"><span className="overlay-wait-pulse" /><div><strong>Waiting for League Client…</strong><p>The overlay checks for League every five seconds and reconnects automatically.</p></div></section>}

      {!visible && <p className="overlay-hidden-note">Overlay details hidden <button type="button" onClick={() => setVisible(true)}>Show</button></p>}

      {visible && <>

      {snapshot?.phase !== "disconnected" && <section className="overlay-champion">
        {champion ? <Image src={champion.iconUrl} alt="" width={42} height={42} unoptimized /> : <div className="overlay-champion-placeholder">?</div>}
        <div><span>Level {snapshot?.champion.level ?? 1}</span><h1>{champion?.name || snapshot?.champion.name || "No champion"}</h1></div>
        {championMeta && <a href={championMeta.sourceUrl} target="_blank" rel="noreferrer"><strong>{championMetaPercent?.toFixed(1)}%</strong><span>{championMeta.sourceName === "riot_api_local" ? `Local WR · ${championMeta.sampleSize ?? 0} games` : `Meta WR · ${championMeta.tier}`}</span></a>}
      </section>}

      {snapshot?.phase === "disconnected" ? null : snapshot?.phase === "arena_lobby" ? <LobbyScanner snapshot={snapshot} /> : snapshot?.phase === "champ_select" ? <ChampSelectAssistant champions={champions} snapshot={snapshot} compact /> : snapshot?.phase === "in_progress" ? <>
        <LiveGameHUD snapshot={snapshot} build={liveBuild} augments={currentEntities.filter((entity) => entity.kind === "augment")} />
        <ItemAssistant snapshot={snapshot} championId={champion?.id ?? snapshot.champion.id} augments={currentEntities.filter((entity) => entity.kind === "augment")} />
        {recommendation?.screenshotExtracted && <section className="overlay-offers"><div className="overlay-section-title"><span>Screenshot offers</span><b>Ranked</b></div><div className="overlay-verdict"><span>AI pick</span><strong>{recommendation.recommendation.name}</strong><p>{recommendation.recommendation.rationale}</p></div></section>}
      </> : snapshot?.phase === "post_game" ? <PostGameAnalysis championName={snapshot.champion.name} /> : snapshot?.phase === "augment_select" || displayedOffers.length > 0 ? (
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

      {visible && snapshot?.phase !== "disconnected" && snapshot?.phase !== "post_game" && <ScreenshotPickerControl
        championId={champion?.id ?? snapshot?.champion.id}
        level={snapshot?.champion.level ?? 18}
        currentEntityKeys={currentEntities.map((entity) => entity.entityKey)}
        onResult={(result) => { setRecommendation(result); setError(""); }}
      />}

      {visible && snapshot?.phase !== "disconnected" && snapshot?.phase !== "in_progress" && snapshot?.phase !== "post_game" && <section className="overlay-hud">
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
