"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { DRAFT_STATS, type DraftStatKey } from "@/engine/draft-picker";
import type { AIPickerRequest, AIPickerResponse } from "@/lib/ai-picker-types";
import type { Champion, EntityOption } from "@/lib/types";

const STAT_LABELS: Record<DraftStatKey, string> = {
  maxHealth: "HP",
  totalAttackDamage: "AD",
  abilityPower: "AP",
  attackSpeed: "AS",
  armor: "Armor",
  magicResistance: "MR",
  moveSpeed: "MS",
  abilityHaste: "Haste",
  effectiveCooldownReductionPercent: "Effective CDR",
};

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function display(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  if (Math.abs(value) >= 10_000) return Math.round(value).toLocaleString();
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1);
}

async function postPicker(body: AIPickerRequest, signal?: AbortSignal): Promise<AIPickerResponse> {
  const response = await fetch("/api/ai-picker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const payload = await response.json() as AIPickerResponse | { error: string };
  if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Draft evaluation failed.");
  return payload;
}

export function AIPicker({ champions, entities }: { champions: Champion[]; entities: EntityOption[] }) {
  const augments = useMemo(() => entities.filter((entity) => entity.kind === "augment"), [entities]);
  const initialChampion = champions.find((champion) => champion.key === "Sion") ?? champions[0];
  const [championId, setChampionId] = useState(String(initialChampion?.id ?? ""));
  const [level, setLevel] = useState("18");
  const [opponent, setOpponent] = useState("");
  const [currentEntityKeys, setCurrentEntityKeys] = useState<string[]>([]);
  const [currentPicker, setCurrentPicker] = useState("");
  const [offers, setOffers] = useState(["", "", ""]);
  const [permanentHealth, setPermanentHealth] = useState("0");
  const [sionSmallUnits, setSionSmallUnits] = useState("0");
  const [cursedPower, setCursedPower] = useState("0");
  const [takedowns, setTakedowns] = useState("0");
  const [heartsteelStacks, setHeartsteelStacks] = useState("0");
  const [screenshotDataUrl, setScreenshotDataUrl] = useState("");
  const [screenshotName, setScreenshotName] = useState("");
  const [result, setResult] = useState<AIPickerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedChampion = champions.find((champion) => String(champion.id) === championId);
  const makeRequest = (useAI: boolean): AIPickerRequest => ({
    championId,
    level: numeric(level),
    opponent: champions.find((champion) => String(champion.id) === opponent)?.name || opponent,
    currentEntityKeys,
    offeredAugmentKeys: offers.every(Boolean) ? offers : undefined,
    screenshotDataUrl: useAI && !offers.every(Boolean) ? screenshotDataUrl : undefined,
    scenario: {
      permanentHealth: numeric(permanentHealth),
      sionSmallUnits: numeric(sionSmallUnits),
      cursedPower: numeric(cursedPower),
      takedowns: numeric(takedowns),
      heartsteelStacks: numeric(heartsteelStacks),
    },
    useAI,
  });

  useEffect(() => {
    if (!championId || !offers.every(Boolean) || new Set(offers).size !== 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLiveLoading(true);
      try {
        setResult(await postPicker(makeRequest(false), controller.signal));
        setError("");
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!controller.signal.aborted) setLiveLoading(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // Primitive form state below intentionally retriggers the free local comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [championId, level, opponent, currentEntityKeys, offers, permanentHealth, sionSmallUnits, cursedPower, takedowns, heartsteelStacks]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!offers.every(Boolean) && !screenshotDataUrl) {
      setError("Choose all three offers or attach a screenshot.");
      return;
    }
    setLoading(true);
    setError("");
    try { setResult(await postPicker(makeRequest(true))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }

  function addCurrent() {
    if (currentPicker && !currentEntityKeys.includes(currentPicker)) setCurrentEntityKeys([...currentEntityKeys, currentPicker]);
    setCurrentPicker("");
  }

  async function attachScreenshot(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setScreenshotDataUrl(String(reader.result ?? "")); setScreenshotName(file.name); };
    reader.readAsDataURL(file);
  }

  return (
    <form className="picker-layout" onSubmit={submit}>
      <section className="picker-controls">
        <div className="picker-card picker-game-state">
          <div className="picker-card-title"><span className="eyebrow">1 · Game state</span><strong>{selectedChampion?.name ?? "Champion"}</strong></div>
          <div className="picker-form-grid">
            <label>Champion<select value={championId} onChange={(event) => setChampionId(event.target.value)}>{champions.map((champion) => <option value={champion.id} key={champion.id}>{champion.name}</option>)}</select></label>
            <label>Level<input type="number" min="1" max="30" value={level} onChange={(event) => setLevel(event.target.value)} /></label>
            <label>Opponent<select value={opponent} onChange={(event) => setOpponent(event.target.value)}><option value="">Unknown / mixed lobby</option>{champions.map((champion) => <option value={champion.id} key={champion.id}>{champion.name}</option>)}</select></label>
          </div>
          <label className="wide-label">Current items and augments</label>
          <div className="picker-add-row"><select value={currentPicker} onChange={(event) => setCurrentPicker(event.target.value)}><option value="">Add current item or augment…</option>{entities.map((entity) => <option value={entity.entityKey} key={entity.entityKey}>{entity.kind === "item" ? "Item · " : "Augment · "}{entity.name}</option>)}</select><button type="button" onClick={addCurrent}>Add</button></div>
          <div className="picker-chips">{currentEntityKeys.map((key) => { const entity = entities.find((candidate) => candidate.entityKey === key); return entity ? <button type="button" onClick={() => setCurrentEntityKeys(currentEntityKeys.filter((candidate) => candidate !== key))} key={key}><Image src={entity.iconUrl} width={22} height={22} alt="" unoptimized />{entity.name}<span>×</span></button> : null; })}</div>
          <details className="picker-advanced"><summary>Stack inputs for scaling builds</summary><div className="picker-form-grid stack-grid"><label>Permanent HP<input type="number" min="0" value={permanentHealth} onChange={(event) => setPermanentHealth(event.target.value)} /></label><label>Sion small units<input type="number" min="0" value={sionSmallUnits} onChange={(event) => setSionSmallUnits(event.target.value)} /></label><label>Cursed Power<input type="number" min="0" value={cursedPower} onChange={(event) => setCursedPower(event.target.value)} /></label><label>Takedowns<input type="number" min="0" value={takedowns} onChange={(event) => setTakedowns(event.target.value)} /></label><label>Heartsteel stacks<input type="number" min="0" value={heartsteelStacks} onChange={(event) => setHeartsteelStacks(event.target.value)} /></label></div></details>
        </div>

        <div className="picker-card">
          <div className="picker-card-title"><span className="eyebrow">2 · Draft offers</span><strong>{liveLoading ? "Calculating…" : "Pick three"}</strong></div>
          <div className="offer-selects">{offers.map((offer, index) => <label key={index}>Option {String.fromCharCode(65 + index)}<select value={offer} onChange={(event) => setOffers(offers.map((value, optionIndex) => optionIndex === index ? event.target.value : value))}><option value="">Select augment…</option>{augments.map((augment) => <option disabled={offers.includes(augment.entityKey) && offer !== augment.entityKey} value={augment.entityKey} key={augment.entityKey}>{augment.name} · {augment.rarity}</option>)}</select></label>)}</div>
          <div className="screenshot-row"><label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void attachScreenshot(event.target.files?.[0])} /><span>{screenshotName || "Attach draft screenshot"}</span></label>{screenshotName && <button type="button" onClick={() => { setScreenshotDataUrl(""); setScreenshotName(""); }}>Clear</button>}</div>
          <p className="picker-help">Manual options recalculate locally after 300 ms. A screenshot is sent to OpenAI only when you press Ask AI and manual options are incomplete.</p>
          <button className="picker-submit" disabled={loading} type="submit">{loading ? "Analyzing draft…" : "Ask AI for the pick"}</button>
          {error && <p className="picker-error">{error}</p>}
        </div>
      </section>

      <section className="picker-results" aria-live="polite">
        {!result ? <div className="picker-empty"><strong>Your three comparisons appear here</strong><span>Select the offers to run the local resolver without spending an AI call.</span></div> : <>
          <div className="picker-recommendation"><div><span className="eyebrow">{result.provider === "openai" ? `AI recommendation · ${result.model}` : "Mechanical leader"}</span><h2>{result.recommendation.name}</h2><p>{result.recommendation.rationale}</p></div><strong>{Math.round(result.recommendation.confidence * 100)}%</strong></div>
          {result.warning && <p className="picker-warning">{result.warning}</p>}
          <div className="picker-option-grid">{result.options.map((option, index) => <article className={option.entity.entityKey === result.recommendation.entityKey ? "recommended" : ""} key={option.entity.entityKey}><div className="picker-option-head"><Image src={option.entity.iconUrl} width={46} height={46} alt="" unoptimized /><div><span>Option {String.fromCharCode(65 + index)} · {option.entity.rarity}</span><h3>{option.entity.name}</h3></div></div><p>{option.entity.description}</p>{!option.entity.executable && <small>Conditional effect: shown to AI, but no universal numeric delta is applied yet.</small>}<div className="delta-grid">{DRAFT_STATS.map((stat) => <div className={Math.abs(option.deltas[stat]) > 0.001 ? "changed" : ""} key={stat}><span>{STAT_LABELS[stat]}</span><strong>{display(option.resolved.stats[stat])}</strong><em>{option.deltas[stat] > 0 ? "+" : ""}{display(option.deltas[stat])}</em></div>)}</div></article>)}</div>
        </>}
      </section>
    </form>
  );
}
