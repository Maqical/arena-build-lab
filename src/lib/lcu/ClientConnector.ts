import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);

export type LcuJsonApiEvent = {
  eventType: "Create" | "Update" | "Delete" | string;
  uri: string;
  data: unknown;
};

export type LcuConnectorStatus = {
  state: "stopped" | "searching" | "connecting" | "connected" | "retrying";
  connected: boolean;
  lockfileSource: string;
  port: number | null;
  attempt: number;
  retryInMs: number | null;
  lastError: string;
  updatedAt: string;
};

type LcuCredentials = {
  processName: string;
  processId: number;
  port: number;
  password: string;
  protocol: string;
  lockfilePath: string;
};

export type ClientConnectorOptions = {
  retryIntervalMs?: number;
  additionalLockfiles?: string[];
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseLeagueLockfile(contents: string, lockfilePath: string): LcuCredentials {
  const [processName, processIdText, portText, password, protocol] = contents.trim().split(":");
  const processId = Number(processIdText);
  const port = Number(portText);
  if (!processName || !Number.isInteger(processId) || processId <= 0 || !Number.isInteger(port) || port < 1 || port > 65_535 || !password || !protocol) {
    throw new Error(`Invalid League lockfile format at ${lockfilePath}`);
  }
  return { processName, processId, port, password, protocol, lockfilePath };
}

async function fileExists(filename: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filename);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function windowsProcessInstallPaths(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    const command = "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty ExecutablePath";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 4_000 });
    return stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).map((executable) => path.dirname(executable));
  } catch {
    return [];
  }
}

async function windowsMetadataInstallPath(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const metadata = path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "Riot Games", "Metadata", "league_of_legends.live", "league_of_legends.live.product_settings.yaml");
  try {
    const contents = await fs.readFile(metadata, "utf8");
    const match = contents.match(/^product_install_full_path:\s*["']?(.+?)["']?\s*$/m);
    return match?.[1] ? [match[1].replaceAll("/", path.sep)] : [];
  } catch {
    return [];
  }
}

export async function leagueLockfileCandidates(additional: readonly string[] = []): Promise<string[]> {
  const configured = process.env.LEAGUE_LOCKFILE_PATH?.trim();
  const processPaths = await windowsProcessInstallPaths();
  const metadataPaths = await windowsMetadataInstallPath();
  const home = os.homedir();
  const installDirectories = [
    ...processPaths,
    ...metadataPaths,
    process.platform === "win32" ? "C:\\Riot Games\\League of Legends" : "",
    process.platform === "win32" ? "C:\\Program Files\\Riot Games\\League of Legends" : "",
    process.platform === "win32" ? "C:\\Program Files (x86)\\Riot Games\\League of Legends" : "",
    process.platform === "darwin" ? "/Applications/League of Legends.app/Contents/LoL" : "",
    process.platform !== "win32" && process.platform !== "darwin" ? path.join(home, "Games", "league-of-legends", "drive_c", "Riot Games", "League of Legends") : "",
  ].filter(Boolean);
  return [...new Set([
    ...(configured ? [configured] : []),
    ...additional,
    ...installDirectories.map((directory) => path.join(directory, "lockfile")),
  ].map((candidate) => path.resolve(candidate)))];
}

export class ClientConnector extends EventEmitter {
  private readonly retryIntervalMs: number;
  private readonly additionalLockfiles: string[];
  private credentials: LcuCredentials | null = null;
  private socket: WebSocket | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private cancelRetry: (() => void) | null = null;
  private status: LcuConnectorStatus = {
    state: "stopped",
    connected: false,
    lockfileSource: "",
    port: null,
    attempt: 0,
    retryInMs: null,
    lastError: "",
    updatedAt: new Date().toISOString(),
  };

  constructor(options: ClientConnectorOptions = {}) {
    super();
    this.retryIntervalMs = Math.max(250, options.retryIntervalMs ?? 5_000);
    this.additionalLockfiles = options.additionalLockfiles ?? [];
  }

  snapshot(): LcuConnectorStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.connectionLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.cancelRetry?.();
    this.cancelRetry = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.credentials = null;
    this.setStatus({ state: "stopped", connected: false, port: null, retryInMs: null });
    await this.loopPromise;
    this.loopPromise = null;
  }

  async requestJson<T>(endpoint: string, allowNotFound = true): Promise<T | null> {
    const credentials = this.credentials;
    if (!credentials) throw new Error("League Client is not connected.");
    return new Promise<T | null>((resolve, reject) => {
      const request = https.request({
        hostname: "127.0.0.1",
        port: credentials.port,
        path: endpoint,
        method: "GET",
        headers: { Authorization: `Basic ${Buffer.from(`riot:${credentials.password}`).toString("base64")}`, Accept: "application/json" },
        rejectUnauthorized: false,
        timeout: 4_000,
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          if (response.statusCode === 404 && allowNotFound) return resolve(null);
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`LCU ${endpoint} returned HTTP ${response.statusCode ?? "unknown"}.`));
          try { resolve(body ? JSON.parse(body) as T : null); }
          catch { reject(new Error(`LCU ${endpoint} returned invalid JSON.`)); }
        });
      });
      request.on("timeout", () => request.destroy(new Error(`LCU ${endpoint} timed out.`)));
      request.on("error", reject);
      request.end();
    });
  }

  private setStatus(update: Partial<LcuConnectorStatus>): void {
    this.status = { ...this.status, ...update, updatedAt: new Date().toISOString() };
    this.emit("status", this.snapshot());
  }

  private async findCredentials(): Promise<LcuCredentials> {
    this.setStatus({ state: "searching", connected: false, port: null, retryInMs: null });
    for (const candidate of await leagueLockfileCandidates(this.additionalLockfiles)) {
      if (!await fileExists(candidate)) continue;
      try { return parseLeagueLockfile(await fs.readFile(candidate, "utf8"), candidate); }
      catch { /* A stale or partially-written candidate is skipped. */ }
    }
    throw new Error("League Client lockfile was not found. Start League or set LEAGUE_LOCKFILE_PATH.");
  }

  private async connectionLoop(): Promise<void> {
    let attempt = 0;
    while (this.running) {
      try {
        const credentials = await this.findCredentials();
        this.credentials = credentials;
        this.setStatus({ state: "connecting", lockfileSource: credentials.lockfilePath, port: credentials.port, attempt, lastError: "", retryInMs: null });
        await this.openEventSocket(credentials);
        attempt = 0;
      } catch (error) {
        if (!this.running) break;
        this.credentials = null;
        attempt += 1;
        const retryInMs = this.retryIntervalMs;
        this.setStatus({ state: "retrying", connected: false, port: null, attempt, retryInMs, lastError: messageOf(error) });
        await this.waitForRetry(retryInMs);
      }
    }
  }

  private waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.cancelRetry = null;
        resolve();
      };
      this.cancelRetry = finish;
      this.retryTimer = setTimeout(finish, delayMs);
    });
  }

  private openEventSocket(credentials: LcuCredentials): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false;
      const authorization = `Basic ${Buffer.from(`riot:${credentials.password}`).toString("base64")}`;
      const socket = new WebSocket(`wss://127.0.0.1:${credentials.port}/`, { headers: { Authorization: authorization }, rejectUnauthorized: false, handshakeTimeout: 5_000 });
      this.socket = socket;
      socket.once("open", () => {
        opened = true;
        socket.send(JSON.stringify([5, "OnJsonApiEvent"]));
        this.setStatus({ state: "connected", connected: true, port: credentials.port, attempt: 0, retryInMs: null, lastError: "" });
        this.emit("connect");
      });
      socket.on("message", (message) => {
        try {
          const frame = JSON.parse(message.toString()) as unknown;
          if (!Array.isArray(frame) || frame[0] !== 8 || frame[1] !== "OnJsonApiEvent") return;
          const event = frame[2] as LcuJsonApiEvent;
          if (event && typeof event.uri === "string") this.emit("json-api-event", event);
        } catch { /* Ignore malformed/unrelated WAMP frames. */ }
      });
      socket.once("error", (error) => {
        if (!opened) reject(error);
      });
      socket.once("close", () => {
        this.socket = null;
        this.credentials = null;
        this.setStatus({ connected: false, port: null });
        this.emit("disconnect");
        if (opened && this.running) this.emit("connection-lost");
        if (opened) resolve();
        else reject(new Error("League Client event socket closed before connecting."));
      });
    });
  }
}
