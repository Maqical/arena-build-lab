"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { calculateStatChain, EMPTY_STATS, STAT_LABELS } from "@/lib/stat-engine";
import type { Champion, FormulaSelection, StatFormula, StatKey, StatValues } from "@/lib/types";

const EDITABLE_STATS: StatKey[] = [
  "maxHealth", "bonusHealth", "maxMana", "baseAttackDamage", "bonusAttackDamage", "abilityPower", "abilityHaste",
  "moveSpeed", "attackSpeedPercent", "critChancePercent", "critDamagePercent", "cursedPower",
];

const RESULT_STATS: StatKey[] = [
  "maxHealth", "bonusHealth", "baseAttackDamage", "bonusAttackDamage", "abilityPower", "abilityHaste", "moveSpeed",
  "attackSpeedPercent", "critChancePercent", "critDamagePercent", "onHitPhysicalDamage",
];

function displayNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function StatLab({ champions, formulas, initialChampionKey }: { champions: Champion[]; formulas: StatFormula[]; initialChampionKey: string }) {
  const [championKey, setChampionKey] = useState(initialChampionKey);
  const [stats, setStats] = useState<StatValues>({ ...EMPTY_STATS, maxHealth: 3000, bonusHealth: 1500, maxMana: 1000, moveSpeed: 350 });
  const [selections, setSelections] = useState<FormulaSelection[]>([]);
  const selectedChampion = champions.find((champion) => champion.key === championKey);
  const result = useMemo(() => calculateStatChain(stats, formulas, selections), [stats, formulas, selections]);

  function loadChampionBase() {
    if (!selectedChampion) return;
    const level = 18;
    setStats((current) => ({
      ...current,
      maxHealth: selectedChampion.stats.health + selectedChampion.stats.healthPerLevel * (level - 1),
      bonusHealth: 0,
      maxMana: selectedChampion.partype === "Mana"
        ? selectedChampion.stats.mana + selectedChampion.stats.manaPerLevel * (level - 1)
        : 0,
      baseAttackDamage: selectedChampion.stats.attackDamage + selectedChampion.stats.attackDamagePerLevel * (level - 1),
      bonusAttackDamage: 0,
      moveSpeed: selectedChampion.stats.moveSpeed,
    }));
  }

  function toggleFormula(formula: StatFormula) {
    setSelections((current) => current.some((selection) => selection.formulaId === formula.id)
      ? current.filter((selection) => selection.formulaId !== formula.id)
      : [...current, { formulaId: formula.id, level: 1 }]);
  }

  return (
    <section className="tool-page" data-testid="stat-lab">
      <div className="tool-hero">
        <div><span className="eyebrow">Executable mechanic graph</span><h2>Stat Conversion Lab</h2></div>
        <p>Enter the stats visible in your match, select the effects you own, and inspect every conversion in application order.</p>
      </div>

      <div className="stat-layout">
        <section className="tool-card stat-inputs">
          <div className="tool-card-heading"><div><span className="eyebrow">Starting state</span><h3>Your current stats</h3></div></div>
          <div className="champion-preset">
            <select value={championKey} onChange={(event) => setChampionKey(event.target.value)} aria-label="Stat Lab champion">
              <option value="">Choose a champion preset</option>
              {champions.map((champion) => <option value={champion.key} key={champion.key}>{champion.name}</option>)}
            </select>
            <button type="button" onClick={loadChampionBase} disabled={!selectedChampion}>Load L18 base</button>
          </div>
          <p className="field-help">Base presets come from the current DDragon patch. Add item, anvil, quest, and round bonuses manually.</p>
          <div className="number-grid">
            {EDITABLE_STATS.map((key) => (
              <label key={key}>
                <span>{STAT_LABELS[key]}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={stats[key]}
                  onChange={(event) => setStats((current) => ({ ...current, [key]: Number(event.target.value) }))}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="tool-card formula-picker">
          <div className="tool-card-heading"><div><span className="eyebrow">Patch {formulas[0]?.patch ?? "unknown"}</span><h3>Conversion effects</h3></div><strong>{selections.length} active</strong></div>
          <div className="formula-list">
            {formulas.map((formula) => {
              const selection = selections.find((item) => item.formulaId === formula.id);
              return (
                <article className={selection ? "formula-row selected" : "formula-row"} key={formula.id}>
                  <button type="button" className="formula-toggle" onClick={() => toggleFormula(formula)} aria-pressed={Boolean(selection)}>
                    <Image src={formula.iconUrl} alt="" width={40} height={40} unoptimized />
                    <span><strong>{formula.entityName}</strong><small>{formula.description}</small></span>
                    <b>{selection ? "On" : "Off"}</b>
                  </button>
                  {selection && formula.ranks.length > 1 && (
                    <label className="rank-select">Upgrade
                      <select value={selection.level} onChange={(event) => setSelections((current) => current.map((item) => item.formulaId === formula.id ? { ...item, level: Number(event.target.value) } : item))}>
                        {formula.ranks.map((rank) => <option value={rank.level} key={rank.level}>Level {rank.level}</option>)}
                      </select>
                    </label>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="tool-card stat-output">
          <div className="tool-card-heading"><div><span className="eyebrow">Calculated output</span><h3>Resulting stats</h3></div></div>
          <div className="result-stat-grid">
            {RESULT_STATS.map((key) => (
              <div className={Math.abs(result.stats[key] - stats[key]) > 0.0001 ? "changed" : ""} data-stat-key={key} key={key}>
                <span>{STAT_LABELS[key]}</span><strong>{displayNumber(result.stats[key])}{key.endsWith("Percent") ? "%" : ""}</strong>
              </div>
            ))}
          </div>
          <div className="calculation-trace">
            <span className="eyebrow">Auditable calculation trace</span>
            {result.steps.length === 0 && <p>Select an effect to see each calculation here.</p>}
            {result.steps.map((step) => (
              <div key={step.formulaId}>
                <strong>{step.entityName}</strong>
                <span>{step.expression} = +{displayNumber(step.delta)} {STAT_LABELS[step.targetStat].toLowerCase()}</span>
              </div>
            ))}
            {result.warnings.map((warning) => <p className="formula-warning" key={warning}>{warning}</p>)}
          </div>
          <p className="field-help">“Exact” means the operation and coefficients come from current structured game data or explicit item text. Trigger timing, caps outside the formula, and mode-specific modifiers can still affect the live result.</p>
        </section>
      </div>
    </section>
  );
}
