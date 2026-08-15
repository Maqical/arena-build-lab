"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RunTracker } from "@/components/run-tracker";
import { StatLab } from "@/components/stat-lab";
import type { CatalogEntity, Champion, Combo, EntityOption, StatFormula, Video, VideoStatClaim } from "@/lib/types";

type Overview = {
  champions: number;
  augments: number;
  items: number;
  curatedCombos: number;
  videoCombos: number;
  discoveredCombos: number;
  videos: number;
  mentions: number;
  patch: string;
  lastSync: string;
};

type View = "combos" | "augment" | "item" | "videos" | "vstats" | "statlab" | "runs";

const GOALS = [
  ["", "Any ceiling"],
  ["health", "Max HP"],
  ["attack_damage", "Attack damage"],
  ["ability_power", "Ability power"],
  ["attack_speed", "Attack speed"],
  ["crit_damage", "Critical burst"],
  ["heal_shield", "Healing engine"],
  ["autocast", "Autocast"],
  ["stat_anvil", "Stat anvils"],
  ["stacking", "Infinite stacking"],
] as const;

function rarityLabel(rarity: string): string {
  return rarity === "item" ? "Arena item" : rarity;
}

function EntityCard({ entity, onBuildAround }: { entity: CatalogEntity; onBuildAround: (entity: CatalogEntity) => void }) {
  return (
    <article className={`entity-card rarity-${entity.rarity}`}>
      <div className="entity-topline">
        <Image src={entity.iconUrl} alt="" width={54} height={54} className="entity-icon" unoptimized />
        <div>
          <span className="eyebrow">{rarityLabel(entity.rarity)}</span>
          <h3>{entity.name}</h3>
        </div>
        <span className="entity-id">#{entity.numericId}</span>
      </div>
      <p>{entity.description || entity.tooltip || "No public tooltip text."}</p>
      <div className="tag-row">
        {entity.tags.slice(0, 6).map((tag) => <span key={tag}>{tag.replaceAll("_", " ")}</span>)}
      </div>
      <div className="mechanic-flow">
        {entity.consumes.length > 0 && <span>uses {entity.consumes.join(" · ").replaceAll("_", " ")}</span>}
        {entity.produces.length > 0 && <span>makes {entity.produces.join(" · ").replaceAll("_", " ")}</span>}
      </div>
      {entity.kind === "item" && <div className="price">{entity.purchasable ? `${entity.price.toLocaleString()}g` : "Not directly purchasable"}</div>}
      <button className="build-around" onClick={() => onBuildAround(entity)}>Find matching build paths →</button>
    </article>
  );
}

function ComboCard({ combo }: { combo: Combo }) {
  const originLabel = combo.origin === "video"
    ? "Video-derived build lead"
    : combo.origin === "generated"
      ? "Mechanically discovered"
      : "Curated conversion chain";
  return (
    <article className={`combo-card ${combo.origin}`}>
      <div className="combo-heading">
        <div>
          <span className="eyebrow">{originLabel}</span>
          <h3>{combo.title}</h3>
        </div>
        <span className="score">{combo.score}</span>
      </div>
      <div className="combo-entities">
        {combo.entities.map((entity, index) => (
          <div className="combo-entity" key={entity.entityKey}>
            {index > 0 && <span className="arrow">→</span>}
            <Image src={entity.iconUrl} alt="" width={42} height={42} unoptimized />
            <span>{entity.name}</span>
          </div>
        ))}
      </div>
      <p>{combo.summary}</p>
      <div className="tag-row">
        {combo.goalTags.slice(0, 7).map((tag) => <span key={tag}>{tag.replaceAll("_", " ")}</span>)}
      </div>
      {combo.evidenceUrls.length > 0 && (
        <div className="combo-evidence-links">
          {combo.evidenceUrls.slice(0, 4).map((url, index) => (
            <a className="evidence" href={url} target="_blank" rel="noreferrer" key={url}>
              {combo.evidenceUrls.length === 1 ? "Watch evidence" : `Recorded run ${index + 1}`} ↗
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function VideoCard({ video }: { video: Video }) {
  const evidence = video.mentionDetails.slice(0, 6);
  return (
    <article className="video-card">
      <a href={video.url} target="_blank" rel="noreferrer" className="video-thumb">
        <Image
          src={video.thumbnailUrl || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
          alt=""
          width={320}
          height={180}
          unoptimized
        />
        <span>Open video ↗</span>
      </a>
      <div className="video-body">
        <span className="eyebrow">{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : "Cataloged upload"}</span>
        <h3>{video.title}</h3>
        <p>{video.description || "Description not fetched in the detail pass yet."}</p>
        <div className="video-evidence-list">
          {evidence.map((mention, index) => {
            const timestamp = mention.timestampSeconds == null ? "" : `&t=${Math.floor(mention.timestampSeconds)}s`;
            return (
              <a href={`${video.url}${timestamp}`} target="_blank" rel="noreferrer" key={`${mention.entityName}-${mention.source}-${index}`}>
                <strong>{mention.entityName}</strong>
                <span>{mention.source}{mention.timestampSeconds == null ? "" : ` · ${Math.floor(mention.timestampSeconds / 60)}:${String(Math.floor(mention.timestampSeconds % 60)).padStart(2, "0")}`}</span>
              </a>
            );
          })}
        </div>
        <div className="tag-row video-status-row">
          {video.mentions.length > evidence.length && <span>+{video.mentions.length - evidence.length} more matches</span>}
          <span className={`transcript ${video.transcriptStatus}`}>{video.transcriptStatus.replaceAll("_", " ")}</span>
        </div>
      </div>
    </article>
  );
}

function VideoStatCard({ claim }: { claim: VideoStatClaim }) {
  const display = claim.unit === "%" || claim.value >= 10_000
    ? claim.value.toLocaleString(undefined, { maximumFractionDigits: claim.value < 100 ? 1 : 0 })
    : claim.value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <article className="video-stat-card">
      <div className="video-stat-value">
        <strong>{display}{claim.unit}</strong>
        <span>{claim.statLabel}</span>
      </div>
      <div className="video-stat-body">
        <span className="eyebrow">{claim.championKey || "Unknown champion"}{claim.confidence >= 0.9 ? " · high confidence" : " · reviewed"}</span>
        <a href={claim.url} target="_blank" rel="noreferrer"><h3>{claim.title}</h3></a>
        <p>“{claim.evidenceText}”</p>
        <div className="tag-row">
          <span>{claim.source}</span>
          {claim.publishedAt && <span>{new Date(claim.publishedAt).toLocaleDateString()}</span>}
        </div>
      </div>
    </article>
  );
}

export function ArenaWorkbench({
  overview,
  champions,
  entityOptions,
  statFormulas,
  initialCombos,
}: {
  overview: Overview;
  champions: Champion[];
  entityOptions: EntityOption[];
  statFormulas: StatFormula[];
  initialCombos: Combo[];
}) {
  const [view, setView] = useState<View>("combos");
  const [query, setQuery] = useState("");
  const [goal, setGoal] = useState("");
  const [champion, setChampion] = useState("");
  const [ownedEntityKey, setOwnedEntityKey] = useState("");
  const [showDiscovered, setShowDiscovered] = useState(false);
  const [entities, setEntities] = useState<CatalogEntity[]>([]);
  const [combos, setCombos] = useState<Combo[]>(initialCombos);
  const [videos, setVideos] = useState<Video[]>([]);
  const [statClaims, setStatClaims] = useState<VideoStatClaim[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedChampion = useMemo(
    () => champions.find((candidate) => candidate.key === champion),
    [champion, champions],
  );
  const selectedOwnedEntity = useMemo(
    () => entityOptions.find((candidate) => candidate.entityKey === ownedEntityKey),
    [entityOptions, ownedEntityKey],
  );

  useEffect(() => {
    if (view === "statlab" || view === "runs") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        if (view === "combos") {
          const params = new URLSearchParams({ q: query, goal, champion, owned: ownedEntityKey, curated: String(!showDiscovered), limit: ownedEntityKey ? "24" : "36" });
          const response = await fetch(`/api/combos?${params}`, { signal: controller.signal });
          const payload = await response.json() as { combos: Combo[] };
          setCombos(payload.combos);
        } else if (view === "videos") {
          const params = new URLSearchParams({ q: query, champion, limit: "48" });
          const response = await fetch(`/api/videos?${params}`, { signal: controller.signal });
          const payload = await response.json() as { videos: Video[] };
          setVideos(payload.videos);
        } else if (view === "vstats") {
          const params = new URLSearchParams({ q: query, champion, limit: "120" });
          const response = await fetch(`/api/video-stats?${params}`, { signal: controller.signal });
          const payload = await response.json() as { claims: VideoStatClaim[] };
          setStatClaims(payload.claims);
        } else {
          const params = new URLSearchParams({ kind: view, q: query, tag: goal, limit: "72" });
          const response = await fetch(`/api/catalog?${params}`, { signal: controller.signal });
          const payload = await response.json() as { entities: CatalogEntity[] };
          setEntities(payload.entities);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [view, query, goal, champion, ownedEntityKey, showDiscovered]);

  const explorerView = view === "combos" || view === "augment" || view === "item" || view === "videos" || view === "vstats";
  const resultCount = view === "combos" ? combos.length : view === "videos" ? videos.length : view === "vstats" ? statClaims.length : entities.length;

  return (
    <main className="build-lab-page">
      <section className="workspace">
        <nav className="build-lab-tabs" aria-label="Build Lab sections">
          {([
            ["combos", "⌁", "Build paths"],
            ["augment", "✦", "Augments"],
            ["item", "◇", "Arena items"],
            ["statlab", "∑", "Stat Lab"],
            ["runs", "◎", "My runs"],
            ["videos", "▶", "Video evidence"],
            ["vstats", "❚", "Video stats"],
          ] as const).map(([target, icon, label]) => (
            <button className={view === target ? "active" : ""} onClick={() => setView(target)} key={target}>
              <span>{icon}</span>{label}
            </button>
          ))}
          <Link href="/ai-picker"><span>✦</span>AI picker</Link>
          <Link href="/champ-select"><span>◈</span>Champion select</Link>
        </nav>
        <header className="topbar">
          <div>
            <span className="eyebrow">Patch-aware mechanics explorer</span>
            <h1>Find the line that breaks Arena.</h1>
          </div>
          <div className="source-pill">CDragon + DDragon + video evidence</div>
        </header>

        {explorerView && <>
        <section className="lab-panel">
          <div className="field champion-field">
            <label htmlFor="champion">Champion</label>
            <div className="select-wrap">
              {selectedChampion && <Image src={selectedChampion.iconUrl} alt="" width={34} height={34} unoptimized />}
              <select id="champion" value={champion} onChange={(event) => setChampion(event.target.value)}>
                <option value="">Any champion</option>
                {champions.map((candidate) => <option value={candidate.key} key={candidate.key}>{candidate.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field owned-field">
            <label htmlFor="owned-entity">Already owned</label>
            <div className="select-wrap">
              {selectedOwnedEntity && <Image src={selectedOwnedEntity.iconUrl} alt="" width={34} height={34} unoptimized />}
              <select id="owned-entity" value={ownedEntityKey} onChange={(event) => {
                setOwnedEntityKey(event.target.value);
                if (event.target.value) setShowDiscovered(true);
              }}>
                <option value="">No item or augment selected</option>
                <optgroup label="Augments">
                  {entityOptions.filter((entity) => entity.kind === "augment").map((entity) => (
                    <option value={entity.entityKey} key={entity.entityKey}>{entity.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Items">
                  {entityOptions.filter((entity) => entity.kind === "item").map((entity) => (
                    <option value={entity.entityKey} key={entity.entityKey}>{entity.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <div className="field goal-field">
            <label>Build goal</label>
            <div className="goal-strip">
              {GOALS.map(([value, label]) => (
                <button className={goal === value ? "active" : ""} onClick={() => setGoal(value)} key={value}>{label}</button>
              ))}
            </div>
          </div>
          <div className="field search-field">
            <label htmlFor="search">Search mechanics</label>
            <input id="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Heartsteel, crit, mana, autocast…" />
          </div>
        </section>

        <section className="metrics">
          <div><strong>{overview.augments}</strong><span>current augments</span></div>
          <div><strong>{overview.items}</strong><span>Arena-map records</span></div>
          <div><strong>{overview.curatedCombos}</strong><span>verified chains</span></div>
          <div><strong>{overview.videoCombos}</strong><span>video build leads</span></div>
          <div><strong>{overview.discoveredCombos}</strong><span>mechanic leads</span></div>
          <div><strong>{overview.videos}</strong><span>video records</span></div>
        </section>

        <section className="results-heading">
          <div>
            <span className="eyebrow">{loading ? "Analyzing…" : `${resultCount} results shown`}</span>
            <h2>{view === "combos" ? "Conversion paths" : view === "augment" ? "Augment database" : view === "item" ? "Arena item database" : view === "vstats" ? "Stats called out in video titles" : "Video evidence catalog"}</h2>
            {view === "combos" && selectedOwnedEntity && (
              <p className="anchor-note">Anchored to <strong>{selectedOwnedEntity.name}</strong> — every result contains what you already own.</p>
            )}
            {view === "vstats" && (
              <p className="anchor-note">Lexical claims extracted straight from video titles — e.g. “707 Lethality Pyke”, “257% Shardblade”. Click a card to watch the source video.</p>
            )}
          </div>
          <div className="result-actions">
            {view === "combos" && (
              <label className="toggle">
                <input type="checkbox" checked={showDiscovered} onChange={(event) => setShowDiscovered(event.target.checked)} />
                <span /> Include unverified discoveries
              </label>
            )}
            <a className="export-link" href={`/api/export?kind=${view === "augment" || view === "item" ? view : view === "videos" || view === "vstats" ? "videos" : "combos"}`}>
              Export full CSV ↓
            </a>
          </div>
        </section>

        <section className={`result-grid ${view === "videos" ? "video-grid" : view === "vstats" ? "vstats-grid" : ""}`} aria-busy={loading}>
          {view === "combos" && combos.map((combo) => <ComboCard combo={combo} key={combo.slug} />)}
          {(view === "augment" || view === "item") && entities.map((entity) => (
            <EntityCard
              entity={entity}
              key={entity.entityKey}
              onBuildAround={(selected) => {
                setOwnedEntityKey(selected.entityKey);
                setQuery("");
                setShowDiscovered(true);
                setView("combos");
              }}
            />
          ))}
          {view === "videos" && videos.map((video) => <VideoCard video={video} key={video.videoId} />)}
          {view === "vstats" && statClaims.map((claim) => <VideoStatCard claim={claim} key={`${claim.videoId}:${claim.statKey}:${claim.value}`} />)}
          {!loading && resultCount === 0 && (
            <div className="empty-state">
              <strong>No current-patch matches.</strong>
              <span>Clear a filter or include mechanically discovered candidates.</span>
            </div>
          )}
        </section>
        </>}

        {view === "statlab" && <StatLab champions={champions} formulas={statFormulas} initialChampionKey={champion} />}
        {view === "runs" && <RunTracker champions={champions} entityOptions={entityOptions} initialChampionKey={champion} />}

        <footer>
            Arena Build Lab is an independent community tool. Calculations and extracted evidence remain patch-stamped and auditable.
        </footer>
      </section>
    </main>
  );
}
