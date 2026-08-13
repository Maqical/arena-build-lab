import type { DraftStatKey } from "@/engine/draft-picker";
import type { ResolverResult } from "@/engine/resolver";

export type AIPickerScenario = {
  permanentHealth?: number;
  sionSmallUnits?: number;
  cursedPower?: number;
  takedowns?: number;
  heartsteelStacks?: number;
};

export type AIPickerRequest = {
  championId: number | string;
  level: number;
  mode?: "arena" | "aram_mayhem";
  currentEntityKeys: string[];
  offeredAugmentKeys?: string[];
  opponent?: string;
  screenshotDataUrl?: string;
  scenario?: AIPickerScenario;
  useAI?: boolean;
};

export type PickerEntity = {
  entityKey: string;
  name: string;
  kind: "augment" | "item";
  rarity: string;
  description: string;
  iconUrl: string;
  executable: boolean;
};

export type PickerOption = {
  entity: PickerEntity;
  resolved: ResolverResult;
  deltas: Record<DraftStatKey, number>;
  localScore: number;
};

export type AIPickerResponse = {
  champion: { id?: number; key: string; name: string };
  level: number;
  opponent: string;
  baseline: ResolverResult;
  options: PickerOption[];
  recommendation: {
    entityKey: string;
    name: string;
    rationale: string;
    confidence: number;
  };
  provider: "openai" | "local" | "local-fallback";
  model: string | null;
  warning: string;
  screenshotExtracted: boolean;
};
