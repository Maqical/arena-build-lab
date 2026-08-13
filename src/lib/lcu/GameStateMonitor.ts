import { EventEmitter } from "node:events";
import https from "node:https";
import { ClientConnector, type LcuConnectorStatus, type LcuJsonApiEvent } from "@/lib/lcu/ClientConnector";
import { mergeObservedMaxima, type LiveObservationInput } from "@/lib/live-observations";

type UnknownRecord = Record<string, unknown>;

export type ArenaGamePhase = "disconnected" | "idle" | "arena_lobby" | "champ_select" | "augment_select" | "in_progress" | "post_game";

export type LiveChampionStats = {
  currentHealth: number;
  maxHealth: number;
  attackDamage: number;
  abilityPower: number;
  attackSpeed: number;
  armor: number;
  magicResistance: number;
  moveSpeed: number;
  abilityHaste: number;
};

export type GameStateSnapshot = {
  sequence: number;
  connection: LcuConnectorStatus;
  phase: ArenaGamePhase;
  rawPhase: string;
  isArena: boolean;
  queueId: number | null;
  queueName: string;
  champion: { id: number | null; name: string; level: number };
  lobbyMembers: Array<{ puuid: string; gameName: string; tagLine: string }>;
  currentEntityRefs: string[];
  offeredAugmentRefs: string[];
  liveStats: LiveChampionStats | null;
  offerFeed: {
    status: "waiting" | "detected" | "not_exposed";
    sourceUri: string;
    detectedAt: string;
    note: string;
    observedCandidateUris: string[];
  };
  updatedAt: string;
};

type GameflowSession = UnknownRecord & {
  phase?: string;
  map?: UnknownRecord;
  gameData?: UnknownRecord;
};

type ChampSelectSession = UnknownRecord & {
  localPlayerCellId?: number;
  myTeam?: Array<UnknownRecord>;
};

const EMPTY_CONNECTION: LcuConnectorStatus = {
  state: "stopped",
  connected: false,
  lockfileSource: "",
  port: null,
  attempt: 0,
  retryInMs: null,
  lastError: "",
  updatedAt: new Date(0).toISOString(),
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedAugmentRef(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return `augment:${value}`;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^augment:\d+$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^\d+$/.test(trimmed)) return `augment:${Number(trimmed)}`;
    return trimmed || null;
  }
  const object = record(value);
  if (!object) return null;
  for (const key of ["augmentId", "id", "perkId", "numericId", "apiName", "name"]) {
    const result = normalizedAugmentRef(object[key]);
    if (result) return result;
  }
  return null;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** Conservative extractor for current/future LCU payloads that explicitly name a three-option augment offer. */
export function extractOfferedAugmentRefs(uri: string, data: unknown): string[] {
  if (!/(augment|cherry|perk)/i.test(uri)) return [];
  if (Array.isArray(data) && data.length === 3 && /(augment|perk).*(offer|option|choice|select)|(offer|option|choice|select).*(augment|perk)/i.test(uri)) {
    const directRefs = unique(data.map(normalizedAugmentRef));
    if (directRefs.length === 3) return directRefs;
  }
  const candidates: string[][] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 7) return;
    const object = record(value);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      if (Array.isArray(child) && child.length === 3 && /(augment.*(offer|option|choice)|(?:offer|option|choice).*augment|offeredAugments|augmentChoices|augmentOptions)/i.test(key)) {
        const refs = unique(child.map(normalizedAugmentRef));
        if (refs.length === 3) candidates.push(refs);
      }
      if (depth < 7 && (Array.isArray(child) || record(child))) {
        if (Array.isArray(child)) child.forEach((entry) => visit(entry, depth + 1));
        else visit(child, depth + 1);
      }
    }
  };
  visit(data, 0);
  return candidates[0] ?? [];
}

/** Extracts selected augment-like references from documented or observed Live Client shapes. */
export function extractOwnedAugmentRefs(liveData: unknown): string[] {
  const output: string[] = [];
  const root = record(liveData);
  const active = record(root?.activePlayer);
  const activeName = String(active?.summonerName ?? active?.riotId ?? "");
  const players = Array.isArray(root?.allPlayers) ? root.allPlayers.map(record).filter((entry): entry is UnknownRecord => Boolean(entry)) : [];
  const player = players.find((entry) => String(entry.summonerName ?? entry.riotId ?? "") === activeName)
    ?? players.find((entry) => entry.isActivePlayer === true);

  const augmentNameFromSpell = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const match = value.match(/(?:^|_)Augment_([A-Za-z0-9]+)(?:_|$)/i);
    return match?.[1] ?? null;
  };
  const visit = (value: unknown, keyPath: string, depth: number) => {
    if (depth > 8 || value == null) return;
    const spellAugment = augmentNameFromSpell(value);
    if (spellAugment) output.push(spellAugment);
    if (Array.isArray(value)) {
      if (/(augment|generalRunes|selectedPerks|perkIds)/i.test(keyPath)) output.push(...value.map(normalizedAugmentRef).filter((entry): entry is string => Boolean(entry)));
      value.forEach((entry, index) => visit(entry, `${keyPath}.${index}`, depth + 1));
      return;
    }
    const object = record(value);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      if (/(?:^|_)(augmentId|selectedAugment|ownedAugment|perkId)$/i.test(key) && !Array.isArray(child) && !record(child)) {
        output.push(normalizedAugmentRef(child) ?? "");
      }
      visit(child, `${keyPath}.${key}`, depth + 1);
    }
  };
  if (active) visit(active, "activePlayer", 0);
  if (player) visit(player, "activePlayerRecord", 0);
  if (root?.arena) visit(root.arena, "arena", 0);
  if (root?.augments) visit(root.augments, "augments", 0);
  return unique(output);
}

function itemRefsFromLiveData(liveData: UnknownRecord): string[] {
  const active = record(liveData.activePlayer);
  const allPlayers = Array.isArray(liveData.allPlayers) ? liveData.allPlayers.map(record).filter((entry): entry is UnknownRecord => Boolean(entry)) : [];
  const activeName = String(active?.summonerName ?? active?.riotId ?? "");
  const player = allPlayers.find((entry) => String(entry.summonerName ?? entry.riotId ?? "") === activeName) ?? allPlayers.find((entry) => entry.isActivePlayer === true);
  if (!player || !Array.isArray(player.items)) return [];
  return unique(player.items.map((item) => {
    const entry = record(item);
    const id = Number(entry?.itemID ?? entry?.itemId ?? entry?.id ?? 0);
    return Number.isInteger(id) && id > 0 ? `item:${id}` : null;
  }));
}

function liveChampion(liveData: UnknownRecord): { name: string; level: number; stats: LiveChampionStats | null } {
  const active = record(liveData.activePlayer);
  if (!active) return { name: "", level: 1, stats: null };
  const allPlayers = Array.isArray(liveData.allPlayers) ? liveData.allPlayers.map(record).filter((entry): entry is UnknownRecord => Boolean(entry)) : [];
  const activeName = String(active.summonerName ?? active.riotId ?? "");
  const player = allPlayers.find((entry) => String(entry.summonerName ?? entry.riotId ?? "") === activeName) ?? allPlayers.find((entry) => entry.isActivePlayer === true);
  const stats = record(active.championStats);
  return {
    name: String(player?.championName ?? ""),
    level: Math.max(1, Math.trunc(finite(active.level) || 1)),
    stats: stats ? {
      currentHealth: finite(stats.currentHealth),
      maxHealth: finite(stats.maxHealth),
      attackDamage: finite(stats.attackDamage),
      abilityPower: finite(stats.abilityPower),
      attackSpeed: finite(stats.attackSpeed),
      armor: finite(stats.armor),
      magicResistance: finite(stats.magicResist),
      moveSpeed: finite(stats.moveSpeed),
      abilityHaste: finite(stats.abilityHaste),
    } : null,
  };
}

function championFromSelect(session: ChampSelectSession | null): number | null {
  const localCell = Number(session?.localPlayerCellId);
  if (!Number.isInteger(localCell) || !Array.isArray(session?.myTeam)) return null;
  const player = session.myTeam.map(record).find((entry) => Number(entry?.cellId) === localCell);
  const id = Number(player?.championId ?? player?.championPickIntent ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function lobbyMembers(lobby: UnknownRecord | null, champSelect: ChampSelectSession | null): GameStateSnapshot["lobbyMembers"] {
  const candidates = [
    ...(Array.isArray(lobby?.members) ? lobby.members : []),
    ...(Array.isArray(champSelect?.myTeam) ? champSelect.myTeam : []),
  ].map(record).filter((entry): entry is UnknownRecord => Boolean(entry));
  const members = new Map<string, GameStateSnapshot["lobbyMembers"][number]>();
  for (const entry of candidates) {
    const puuid = String(entry.puuid ?? entry.playerUuid ?? entry.summonerPuuid ?? "");
    const gameName = String(entry.gameName ?? entry.summonerName ?? record(entry.riotId)?.gameName ?? "Arena player");
    const tagLine = String(entry.tagLine ?? record(entry.riotId)?.tagLine ?? "");
    const key = puuid || `${gameName}#${tagLine}`;
    if (key) members.set(key, { puuid, gameName, tagLine });
  }
  return [...members.values()];
}

function arenaDetails(session: GameflowSession | null, lobby: UnknownRecord | null): { isArena: boolean; queueId: number | null; queueName: string } {
  const map = record(session?.map);
  const gameData = record(session?.gameData);
  const queue = record(gameData?.queue) ?? record(record(lobby?.gameConfig)?.queue);
  const gameConfig = record(lobby?.gameConfig);
  const modes = [map?.gameMode, map?.gameModeName, queue?.gameMode, queue?.type, gameConfig?.gameMode, gameConfig?.gameModeName].map(String);
  const isArena = modes.some((mode) => /^(CHERRY|Arena)$/i.test(mode)) || Number(map?.id ?? gameConfig?.mapId) === 30;
  const queueId = Number(queue?.id ?? gameConfig?.queueId ?? 0);
  return {
    isArena,
    queueId: Number.isInteger(queueId) && queueId > 0 ? queueId : null,
    queueName: String(queue?.name ?? queue?.description ?? gameConfig?.gameModeName ?? ""),
  };
}

function normalizedPhase(rawPhase: string, isArena: boolean, offers: readonly string[], liveAvailable: boolean): ArenaGamePhase {
  if (offers.length === 3) return "augment_select";
  if (liveAvailable || rawPhase === "InProgress") return "in_progress";
  if (rawPhase === "ChampSelect" && isArena) return "champ_select";
  if (["Lobby", "Matchmaking", "ReadyCheck"].includes(rawPhase) && isArena) return "arena_lobby";
  if (["WaitingForStats", "PreEndOfGame", "EndOfGame"].includes(rawPhase)) return "post_game";
  if (!rawPhase || rawPhase === "None") return "idle";
  return isArena ? "arena_lobby" : "idle";
}

async function liveClientData(): Promise<UnknownRecord | null> {
  return new Promise((resolve) => {
    const request = https.request({ hostname: "127.0.0.1", port: 2999, path: "/liveclientdata/allgamedata", method: "GET", rejectUnauthorized: false, timeout: 1_200 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) return resolve(null);
        try { resolve(record(JSON.parse(body))); } catch { resolve(null); }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
    request.end();
  });
}

async function safeLcu<T>(connector: ClientConnector, endpoint: string): Promise<T | null> {
  try { return await connector.requestJson<T>(endpoint); } catch { return null; }
}

export class GameStateMonitor extends EventEmitter {
  private readonly connector: ClientConnector;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private refreshing = false;
  private sequence = 0;
  private offers: { refs: string[]; sourceUri: string; detectedAt: string; expiresAt: number } | null = null;
  private selectedAugments = new Set<string>();
  private observedCandidateUris = new Set<string>();
  private liveObservation: LiveObservationInput | null = null;
  private snapshotValue: GameStateSnapshot = {
    sequence: 0,
    connection: EMPTY_CONNECTION,
    phase: "disconnected",
    rawPhase: "",
    isArena: false,
    queueId: null,
    queueName: "",
    champion: { id: null, name: "", level: 1 },
    lobbyMembers: [],
    currentEntityRefs: [],
    offeredAugmentRefs: [],
    liveStats: null,
    offerFeed: { status: "waiting", sourceUri: "", detectedAt: "", note: "Waiting for an Arena session.", observedCandidateUris: [] },
    updatedAt: new Date().toISOString(),
  };

  constructor(
    connector = new ClientConnector(),
    private readonly observationSink?: (observation: LiveObservationInput) => Promise<void> | void,
  ) {
    super();
    this.connector = connector;
    connector.on("status", () => void this.refresh());
    connector.on("json-api-event", (event: LcuJsonApiEvent) => this.onLcuEvent(event));
    connector.on("connect", () => void this.refresh());
    connector.on("disconnect", () => void this.refresh());
    connector.on("connection-lost", () => {
      this.emit("ConnectionLost", this.snapshot());
      void this.refresh();
    });
  }

  snapshot(): GameStateSnapshot {
    return structuredClone(this.snapshotValue);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connector.start();
    this.timer = setInterval(() => void this.refresh(), 1_250);
    void this.refresh();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.connector.stop();
  }

  private onLcuEvent(event: LcuJsonApiEvent): void {
    if (/(augment|cherry|perk)/i.test(event.uri)) {
      this.observedCandidateUris.add(event.uri);
      while (this.observedCandidateUris.size > 12) this.observedCandidateUris.delete(this.observedCandidateUris.values().next().value ?? "");
    }
    const offers = extractOfferedAugmentRefs(event.uri, event.data);
    if (offers.length === 3) {
      this.offers = { refs: offers, sourceUri: event.uri, detectedAt: new Date().toISOString(), expiresAt: Date.now() + 90_000 };
    }
    if (/(augment|cherry|perk)/i.test(event.uri) && !/(catalog|game-data\/assets)/i.test(event.uri)) {
      const selected = extractOwnedAugmentRefs({ arena: event.data });
      if (selected.length > 0 && selected.length <= 4) selected.forEach((reference) => this.selectedAugments.add(reference));
    }
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const connection = this.connector.snapshot();
      const [rawPhaseValue, session, lobby, champSelect, live] = await Promise.all([
        connection.connected ? safeLcu<string>(this.connector, "/lol-gameflow/v1/gameflow-phase") : null,
        connection.connected ? safeLcu<GameflowSession>(this.connector, "/lol-gameflow/v1/session") : null,
        connection.connected ? safeLcu<UnknownRecord>(this.connector, "/lol-lobby/v2/lobby") : null,
        connection.connected ? safeLcu<ChampSelectSession>(this.connector, "/lol-champ-select/v1/session") : null,
        liveClientData(),
      ]);
      const rawPhase = String(rawPhaseValue ?? session?.phase ?? (live ? "InProgress" : ""));
      const arena = arenaDetails(session, lobby);
      const livePlayer = live ? liveChampion(live) : { name: "", level: 1, stats: null };
      const gameMode = String(record(live?.gameData)?.gameMode ?? record(live?.gameData)?.mapName ?? "");
      const isArena = arena.isArena || (Boolean(live) && /(CHERRY|Arena|Map30)/i.test(gameMode));
      if (!isArena || ["Lobby", "Matchmaking", "ReadyCheck", "ChampSelect"].includes(rawPhase)) this.selectedAugments.clear();
      if (this.offers && (Date.now() > this.offers.expiresAt || !isArena)) this.offers = null;
      const liveAugments = live ? extractOwnedAugmentRefs(live) : [];
      liveAugments.forEach((reference) => this.selectedAugments.add(reference));
      const currentEntityRefs = live ? unique([...itemRefsFromLiveData(live), ...this.selectedAugments]) : [...this.selectedAugments];
      if (this.offers && this.offers.refs.some((offer) => currentEntityRefs.includes(offer))) this.offers = null;
      const offeredAugmentRefs = this.offers?.refs ?? [];
      const phase = normalizedPhase(rawPhase, isArena, offeredAugmentRefs, Boolean(live));
      const championId = livePlayer.name ? null : championFromSelect(champSelect);
      const offerStatus = offeredAugmentRefs.length === 3 ? "detected" : isArena && phase === "in_progress" ? "not_exposed" : "waiting";
      if (isArena && livePlayer.stats) {
        const previous = this.liveObservation;
        this.liveObservation = {
          championId: previous?.championId ?? this.snapshotValue.champion.id,
          championName: livePlayer.name || previous?.championName || this.snapshotValue.champion.name,
          augmentIds: unique([
            ...(previous?.augmentIds ?? []),
            ...currentEntityRefs.filter((reference) => !/^item:/i.test(reference)),
          ]),
          maxima: mergeObservedMaxima(previous?.maxima ?? null, livePlayer.stats),
          queueId: arena.queueId ?? previous?.queueId ?? this.snapshotValue.queueId,
          startedAt: previous?.startedAt ?? new Date().toISOString(),
          endedAt: new Date().toISOString(),
          source: "live_client",
          extra: { gameMode: gameMode || "CHERRY" },
        };
      }
      const completedObservation = this.liveObservation && this.snapshotValue.phase === "in_progress" && phase !== "in_progress"
        ? { ...this.liveObservation, endedAt: new Date().toISOString() }
        : null;
      if (completedObservation) this.liveObservation = null;
      this.sequence += 1;
      this.snapshotValue = {
        sequence: this.sequence,
        connection,
        phase: connection.connected || live ? phase : "disconnected",
        rawPhase,
        isArena,
        queueId: arena.queueId,
        queueName: arena.queueName,
        champion: { id: championId, name: livePlayer.name, level: livePlayer.level },
        lobbyMembers: lobbyMembers(lobby, champSelect),
        currentEntityRefs,
        offeredAugmentRefs,
        liveStats: livePlayer.stats,
        offerFeed: {
          status: offerStatus,
          sourceUri: this.offers?.sourceUri ?? "",
          detectedAt: this.offers?.detectedAt ?? "",
          note: offerStatus === "detected"
            ? "Three augment offers were read from a local client event."
            : offerStatus === "not_exposed"
              ? "The published LCU and Live Client schemas do not expose Arena's three current offers. Candidate client events are still monitored."
              : "Waiting for an in-game augment offer event.",
          observedCandidateUris: [...this.observedCandidateUris],
        },
        updatedAt: new Date().toISOString(),
      };
      this.emit("change", this.snapshot());
      if (completedObservation) {
        this.emit("live-observation", structuredClone(completedObservation));
        if (this.observationSink) {
          void Promise.resolve()
            .then(() => this.observationSink?.(completedObservation))
            .catch((error) => this.emit("observation-error", error));
        }
      }
    } finally {
      this.refreshing = false;
    }
  }
}

const globalMonitor = globalThis as typeof globalThis & { arenaGameStateMonitor?: GameStateMonitor };

export function getGameStateMonitor(): GameStateMonitor {
  if (!globalMonitor.arenaGameStateMonitor) {
    globalMonitor.arenaGameStateMonitor = new GameStateMonitor(new ClientConnector(), async (observation) => {
      const [{ getDatabase }, { insertLiveObservation }] = await Promise.all([
        import("@/lib/db"),
        import("@/lib/live-observations"),
      ]);
      insertLiveObservation(getDatabase(), observation);
    });
  }
  globalMonitor.arenaGameStateMonitor.start();
  return globalMonitor.arenaGameStateMonitor;
}
