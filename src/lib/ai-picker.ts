import "server-only";

import { compareDraftOptions, localDraftRationale } from "@/engine/draft-picker";
import { DEFAULT_EXTREME_SCENARIO, loadResolverChampion, loadResolverEntity, type ExtremeScenarioInputs, type HydratedResolverEntity } from "@/engine/catalog";
import type { ResolverScenario } from "@/engine/resolver";
import type { AIPickerRequest, AIPickerResponse, PickerEntity } from "@/lib/ai-picker-types";
import { getDatabase } from "@/lib/db";

type OpenAIResponse = { output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };

function pickerEntity(entity: HydratedResolverEntity): PickerEntity {
  return {
    entityKey: entity.entityKey,
    name: entity.name,
    kind: entity.kind,
    rarity: entity.rarity,
    description: entity.description,
    iconUrl: entity.iconUrl,
    executable: entity.executable,
  };
}

function normalizedName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

async function openAIJson<T>(input: unknown, schemaName: string, schema: Record<string, unknown>): Promise<{ data: T; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = process.env.OPENAI_PICKER_MODEL?.trim() || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, store: false, input, text: { format: { type: "json_schema", name: schemaName, strict: true, schema } } }),
  });
  const payload = await response.json() as OpenAIResponse;
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI returned HTTP ${response.status}.`);
  const text = payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no structured output text.");
  return { data: JSON.parse(text) as T, model };
}

async function extractScreenshotAugments(dataUrl: string, augmentNames: string[]): Promise<string[]> {
  if (dataUrl.length > 8_000_000 || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
    throw new Error("Screenshot must be a PNG, JPEG, or WebP under approximately 6 MB.");
  }
  const { data } = await openAIJson<{ options: Array<{ name: string }> }>([
    { role: "developer", content: "Read only the three offered League of Legends Arena augments or ARAM: Mayhem cards. Return them in left-to-right screen order, ignore all other UI text, and never invent an option." },
    { role: "user", content: [
      { type: "input_text", text: `Return exactly three names from this allowed catalog:\n${augmentNames.join("\n")}` },
      { type: "input_image", image_url: dataUrl, detail: "low" },
    ] },
  ], "arena_screenshot_options", {
    type: "object",
    additionalProperties: false,
    properties: { options: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { name: { type: "string" } }, required: ["name"] } } },
    required: ["options"],
  });
  return data.options.map((option) => option.name);
}

function finite(value: unknown, minimum = 0, maximum = 1_000_000): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : 0;
}

export async function evaluateAIPicker(request: AIPickerRequest): Promise<AIPickerResponse> {
  const db = getDatabase();
  const champion = loadResolverChampion(db, String(request.championId));
  if (!champion) throw new Error(`Unknown champion: ${request.championId}`);
  const level = Math.min(Math.max(Math.trunc(finite(request.level, 1, 30)), 1), 30);
  const scenarioInputs: ExtremeScenarioInputs = {
    ...DEFAULT_EXTREME_SCENARIO,
    takedowns: finite(request.scenario?.takedowns, 0, 10_000),
    cursedPower: finite(request.scenario?.cursedPower, 0, 1_000_000),
    heartsteelStacks: finite(request.scenario?.heartsteelStacks, 0, 1_000_000),
  };
  const scenario: ResolverScenario = {
    flatStats: { maxHealth: scenarioInputs.heartsteelStacks, cursedPower: scenarioInputs.cursedPower },
    championPermanentHealth: finite(request.scenario?.permanentHealth, 0, 1_000_000),
    sionSoulFurnace: champion.key === "Sion" ? { smallUnits: finite(request.scenario?.sionSmallUnits, 0, 10_000_000) } : undefined,
  };
  const hydrate = (key: string) => {
    const entity = loadResolverEntity(db, key, scenarioInputs);
    if (!entity) throw new Error(`Unknown entity: ${key}`);
    return entity;
  };
  const current = [...new Set(request.currentEntityKeys ?? [])].map(hydrate);

  const mode = request.mode ?? "arena";
  const augmentRows = db.prepare(`
    SELECT entity_key, numeric_id, name FROM entities
    WHERE kind='augment'
    ORDER BY name, CASE WHEN (?='aram_mayhem' AND numeric_id>=1000) OR (?='arena' AND numeric_id<1000) THEN 0 ELSE 1 END, numeric_id
  `).all(mode, mode) as Array<{ entity_key: string; numeric_id: number; name: string }>;
  let offeredKeys = [...new Set(request.offeredAugmentKeys ?? [])];
  let screenshotExtracted = false;
  if (offeredKeys.length !== 3 && request.screenshotDataUrl) {
    const canonicalRows = [...new Map(augmentRows.map((row) => [normalizedName(row.name), row])).values()];
    const extractedNames = await extractScreenshotAugments(request.screenshotDataUrl, canonicalRows.map((row) => row.name));
    const byName = new Map(canonicalRows.map((row) => [normalizedName(row.name), row.entity_key]));
    offeredKeys = extractedNames.map((name) => byName.get(normalizedName(name)) ?? "");
    if (offeredKeys.some((key) => !key)) throw new Error(`Could not match all screenshot options: ${extractedNames.join(", ")}`);
    screenshotExtracted = true;
  }
  if (offeredKeys.length !== 3) throw new Error("Choose exactly three offered augments or attach a screenshot.");
  const offered = offeredKeys.map(hydrate);
  if (offered.some((entity) => entity.kind !== "augment")) throw new Error("All three draft options must be augments.");

  const compared = compareDraftOptions({
    champion,
    level,
    currentEffects: current.map((entity) => entity.effect),
    offeredEffects: offered.map((entity) => entity.effect),
    options: { scenario },
  });
  const ranked = [...compared.options].sort((left, right) => right.localScore - left.localScore);
  const localChoice = ranked[0];
  let provider: AIPickerResponse["provider"] = "local";
  let model: string | null = null;
  let warning = request.useAI === false ? "Live comparison only; no LLM request was made." : "";
  let recommendation = {
    entityKey: localChoice.effect.key,
    name: localChoice.effect.name,
    rationale: localDraftRationale(localChoice),
    confidence: 0.55,
  };

  if (request.useAI !== false && process.env.OPENAI_API_KEY?.trim()) {
    try {
      const allowedKeys = offered.map((entity) => entity.entityKey);
      const promptState = {
        champion: champion.name,
        level,
        opponent: request.opponent?.trim() || "unknown",
        current: current.map((entity) => ({ name: entity.name, description: entity.description })),
        baselineStats: compared.baseline.stats,
        options: offered.map((entity, index) => ({
          key: entity.entityKey,
          name: entity.name,
          rarity: entity.rarity,
          description: entity.description,
          executableInResolver: entity.executable,
          resolvedDeltas: compared.options[index].deltas,
        })),
      };
      const response = await openAIJson<{ recommendedEntityKey: string; recommendedName: string; rationale: string; confidence: number }>([
        { role: "developer", content: "You are an Arena draft analyst. Use only the supplied option effects and computed deltas, make no win-rate claims, select one allowed key, and justify it in exactly two concise sentences. Conditional effects may matter even when the numeric resolver cannot execute them." },
        { role: "user", content: `Given this game state and the three offered augments, recommend one:\n${JSON.stringify(promptState)}` },
      ], "arena_draft_recommendation", {
        type: "object",
        additionalProperties: false,
        properties: {
          recommendedEntityKey: { type: "string", enum: allowedKeys },
          recommendedName: { type: "string" },
          rationale: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["recommendedEntityKey", "recommendedName", "rationale", "confidence"],
      });
      const chosen = offered.find((entity) => entity.entityKey === response.data.recommendedEntityKey) ?? offered[0];
      recommendation = { entityKey: chosen.entityKey, name: chosen.name, rationale: response.data.rationale, confidence: response.data.confidence };
      provider = "openai";
      model = response.model;
    } catch (error) {
      provider = "local-fallback";
      warning = `AI request failed; showing the local mechanical fallback. ${error instanceof Error ? error.message : String(error)}`;
    }
  } else if (request.useAI !== false) {
    provider = "local-fallback";
    warning = "OPENAI_API_KEY is not configured; showing the local mechanical fallback.";
  }

  return {
    champion: { id: champion.id, key: champion.key, name: champion.name },
    level,
    opponent: request.opponent?.trim() || "Unknown",
    baseline: compared.baseline,
    options: offered.map((entity, index) => ({ entity: pickerEntity(entity), resolved: compared.options[index].result, deltas: compared.options[index].deltas, localScore: compared.options[index].localScore })),
    recommendation,
    provider,
    model,
    warning,
    screenshotExtracted,
  };
}
