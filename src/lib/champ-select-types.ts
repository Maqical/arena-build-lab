import type { ExtremeBuildCsvRow } from "@/lib/extreme-build-csv-core";

export type ChampSelectEntityRecommendation = {
  entityKey: string;
  name: string;
  kind: "augment" | "item";
  rarity: string;
  description: string;
  iconUrl: string;
  tier: string;
  pickRate: number | null;
  reason: string;
};

export type DuoRecommendation = {
  championId: number;
  championKey: string;
  name: string;
  iconUrl: string;
  tags: string[];
  tier: string;
  winRate: number | null;
  pickRate: number | null;
  fitTags: string[];
  synergyScore?: number;
  gamesTogether?: number;
};

export type MatchupRecommendation = {
  championId: number;
  name: string;
  iconUrl: string;
  games: number;
  aheadRate: number;
};

export type ChampSelectRecommendation = {
  champion: { id: number; key: string; name: string; iconUrl: string; tags: string[] };
  meta: { tier: string; winRate: number | null; pickRate: number | null; patch: string } | null;
  duoRecommendations: DuoRecommendation[];
  favorableMatchups: MatchupRecommendation[];
  difficultMatchups: MatchupRecommendation[];
  recommendedAugments: ChampSelectEntityRecommendation[];
  recommendedItems: ChampSelectEntityRecommendation[];
  extremeBuilds: ExtremeBuildCsvRow[];
  note: string;
};
