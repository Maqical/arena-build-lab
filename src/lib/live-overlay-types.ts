import type { ResolverResult } from "@/engine/resolver";

export type LiveResolveRequest = {
  championId: number | string;
  level: number;
  currentEntityKeys: string[];
};

export type LiveResolveResponse = {
  champion: { id?: number; key: string; name: string };
  baseline: ResolverResult;
  build: ResolverResult;
  acceptedEntityKeys: string[];
  ignoredEntityKeys: string[];
  crazeFactor: number;
  crazeLabel: string;
};

export type OverlayCatalogEntity = {
  entityKey: string;
  numericId: number;
  apiName: string;
  name: string;
  kind: "augment" | "item";
  rarity: string;
  description: string;
  iconUrl: string;
};

export type ArenaMetaRecord = {
  entityKey: string;
  kind: "champion" | "augment";
  tier: string;
  winRate: number | null;
  pickRate: number | null;
  patch: string;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  region?: string;
  platform?: string;
  sampleSize?: number;
  metricDefinition?: string;
};
