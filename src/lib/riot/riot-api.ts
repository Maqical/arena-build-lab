export type RiotRoutingRegion = "americas" | "asia" | "europe" | "sea";
export type RiotPlatform =
  | "br1" | "eun1" | "euw1" | "jp1" | "kr" | "la1" | "la2" | "na1" | "oc1"
  | "ph2" | "ru" | "sg2" | "th2" | "tr1" | "tw2" | "vn2";

export type RiotAccount = { puuid: string; gameName?: string; tagLine?: string };

export type ChallengerLeague = {
  entries?: Array<{ puuid?: string; summonerId?: string }>;
};

const RIOT_PLATFORMS = new Set<RiotPlatform>([
  "br1", "eun1", "euw1", "jp1", "kr", "la1", "la2", "na1", "oc1", "ph2",
  "ru", "sg2", "th2", "tr1", "tw2", "vn2",
]);
const RIOT_REGIONS = new Set<RiotRoutingRegion>(["americas", "asia", "europe", "sea"]);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

type RateWindow = {
  limit: number;
  seconds: number;
  count: number;
  observedAt: number;
};

export class RiotApiError extends Error {
  constructor(message: string, readonly status: number, readonly endpoint: string) {
    super(message);
  }
}

function parsePairs(value: string | null): Array<[number, number]> {
  if (!value) return [];
  return value.split(",").flatMap((entry) => {
    const [left, right] = entry.trim().split(":").map(Number);
    return Number.isFinite(left) && Number.isFinite(right) ? [[left, right] as [number, number]] : [];
  });
}

function rateWindows(headers: Headers, now: number): RateWindow[] {
  const output: RateWindow[] = [];
  for (const prefix of ["X-App-Rate-Limit", "X-Method-Rate-Limit"]) {
    const limits = parsePairs(headers.get(prefix));
    const counts = new Map(parsePairs(headers.get(`${prefix}-Count`)).map(([count, seconds]) => [seconds, count]));
    for (const [limit, seconds] of limits) output.push({ limit, seconds, count: counts.get(seconds) ?? 0, observedAt: now });
  }
  return output;
}

export function regionalRouteForPlatform(platform: RiotPlatform): RiotRoutingRegion {
  if (["na1", "br1", "la1", "la2"].includes(platform)) return "americas";
  if (["euw1", "eun1", "tr1", "ru"].includes(platform)) return "europe";
  if (["sg2", "th2", "tw2", "vn2", "ph2"].includes(platform)) return "sea";
  return "asia";
}

export function asRiotPlatform(value: string): RiotPlatform {
  const normalized = value.trim().toLowerCase() as RiotPlatform;
  if (!RIOT_PLATFORMS.has(normalized)) throw new Error(`Unsupported Riot platform: ${value}`);
  return normalized;
}

export function asRiotRoutingRegion(value: string): RiotRoutingRegion {
  const normalized = value.trim().toLowerCase() as RiotRoutingRegion;
  if (!RIOT_REGIONS.has(normalized)) throw new Error(`Unsupported Riot regional route: ${value}`);
  return normalized;
}

export function platformFromTagLine(tagLine: string): RiotPlatform | null {
  const normalized = tagLine.trim().toLowerCase();
  const aliases: Record<string, RiotPlatform> = {
    na: "na1", na1: "na1", br: "br1", br1: "br1", kr: "kr", kr1: "kr",
    euw: "euw1", euw1: "euw1", eune: "eun1", eun1: "eun1", jp: "jp1", jp1: "jp1",
    oce: "oc1", oc1: "oc1", tr: "tr1", tr1: "tr1", ru: "ru",
    lan: "la1", la1: "la1", las: "la2", la2: "la2", sg2: "sg2", th2: "th2",
    tw2: "tw2", vn2: "vn2", ph2: "ph2",
  };
  return aliases[normalized] ?? null;
}

export function parseRiotId(value: string): { gameName: string; tagLine: string } {
  const separator = value.lastIndexOf("#");
  const gameName = value.slice(0, separator).trim();
  const tagLine = value.slice(separator + 1).trim();
  if (separator <= 0 || !gameName || !tagLine) throw new Error('Player must be a Riot ID in the form "Game Name#Tag".');
  return { gameName, tagLine };
}

export class RiotApiClient {
  private windows: RateWindow[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly now: () => number = Date.now,
  ) {
    if (!apiKey.trim()) throw new Error("RIOT_API_KEY is required.");
  }

  private async waitForKnownLimits(): Promise<void> {
    const now = this.now();
    const waits = this.windows
      .filter((window) => window.count >= window.limit)
      .map((window) => window.observedAt + window.seconds * 1_000 - now + 50)
      .filter((milliseconds) => milliseconds > 0);
    if (waits.length) await this.sleep(Math.max(...waits));
  }

  async requestJson<T>(route: RiotRoutingRegion | RiotPlatform, endpoint: string): Promise<T> {
    if (!endpoint.startsWith("/")) throw new Error("Riot API endpoint must start with '/'.");
    const url = `https://${route}.api.riotgames.com${endpoint}`;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.waitForKnownLimits();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { Accept: "application/json", "X-Riot-Token": this.apiKey },
        });
      } catch (error) {
        if (attempt === 5) throw error;
        await this.sleep(Math.min(30_000, 500 * 2 ** attempt));
        continue;
      }
      lastStatus = response.status;
      this.windows = rateWindows(response.headers, this.now());
      if (response.ok) return await response.json() as T;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) {
        const hint = response.status === 401 || response.status === 403
          ? " Check that RIOT_API_KEY is current and authorized for this endpoint."
          : "";
        throw new RiotApiError(`Riot API returned HTTP ${response.status}.${hint}`, response.status, endpoint);
      }
      const retryAfter = Number(response.headers.get("Retry-After"));
      const exponentialMs = Math.min(30_000, 500 * 2 ** attempt);
      const delayMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1_000 : exponentialMs;
      await this.sleep(delayMs);
      if (response.status === 429) this.windows = [];
    }
    throw new RiotApiError(`Riot API remained unavailable after retries (last HTTP ${lastStatus}).`, lastStatus, endpoint);
  }

  resolveAccount(region: RiotRoutingRegion, gameName: string, tagLine: string): Promise<RiotAccount> {
    return this.requestJson(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }

  accountByPuuid(region: RiotRoutingRegion, puuid: string): Promise<RiotAccount> {
    return this.requestJson(region, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`);
  }

  matchIds(
    region: RiotRoutingRegion,
    puuid: string,
    options: { queueId?: number; startTimeSeconds?: number; count?: number } = {},
  ): Promise<string[]> {
    const parameters = new URLSearchParams({ start: "0", count: String(Math.min(Math.max(options.count ?? 20, 1), 100)) });
    if (options.queueId) parameters.set("queue", String(options.queueId));
    if (options.startTimeSeconds) parameters.set("startTime", String(Math.max(0, Math.trunc(options.startTimeSeconds))));
    return this.requestJson(region, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${parameters}`);
  }

  match(region: RiotRoutingRegion, matchId: string): Promise<unknown> {
    return this.requestJson(region, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  challengerLeague(platform: RiotPlatform): Promise<ChallengerLeague> {
    return this.requestJson(platform, "/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5");
  }

  summonerById(platform: RiotPlatform, summonerId: string): Promise<{ puuid?: string }> {
    return this.requestJson(platform, `/lol/summoner/v4/summoners/${encodeURIComponent(summonerId)}`);
  }
}
