export type EntityKind = "augment" | "item";

export type CatalogEntity = {
  entityKey: string;
  kind: EntityKind;
  numericId: number;
  apiName: string;
  name: string;
  rarity: string;
  description: string;
  tooltip: string;
  iconUrl: string;
  purchasable: boolean;
  price: number;
  tags: string[];
  produces: string[];
  consumes: string[];
  patch: string;
  sourceUrl: string;
};

export type Combo = {
  slug: string;
  title: string;
  summary: string;
  entityKeys: string[];
  championTags: string[];
  goalTags: string[];
  score: number;
  evidenceUrl: string;
  evidenceUrls: string[];
  evidenceNote: string;
  patch: string;
  generated: boolean;
  origin: "curated" | "video" | "generated";
  entities: Pick<CatalogEntity, "entityKey" | "name" | "iconUrl" | "rarity" | "kind">[];
};

export type EntityOption = Pick<CatalogEntity, "entityKey" | "name" | "kind" | "iconUrl" | "rarity">;

export type Champion = {
  id: number;
  key: string;
  name: string;
  title: string;
  partype: string;
  tags: string[];
  iconUrl: string;
};

export type Video = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  url: string;
  thumbnailUrl: string;
  transcriptStatus: string;
  mentions: string[];
  mentionDetails: Array<{
    entityName: string;
    source: string;
    timestampSeconds: number | null;
    evidenceText: string;
    confidence: number;
  }>;
};
