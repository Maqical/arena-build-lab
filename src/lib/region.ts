export type CompanionRegion = "na" | "kr" | "global";

export function companionRegion(platform: string, routingRegion = ""): Exclude<CompanionRegion, "global"> | string {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "na1") return "na";
  if (normalized === "kr") return "kr";
  return normalized || routingRegion.trim().toLowerCase() || "unknown";
}

export function selectedRegion(value: string | null | undefined): CompanionRegion {
  return value === "kr" || value === "global" ? value : "na";
}

export function platformForRegion(region: CompanionRegion): "na1" | "kr" | null {
  return region === "na" ? "na1" : region === "kr" ? "kr" : null;
}
