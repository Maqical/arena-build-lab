import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { ClientConnector } from "../src/lib/lcu/ClientConnector";
import { extractOwnedAugmentRefs } from "../src/lib/lcu/GameStateMonitor";

type JsonRecord = Record<string, unknown>;

function argument(name: string, fallback: number): number {
  const raw = process.argv.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1];
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function liveJson(endpoint: string): Promise<unknown> {
  return new Promise((resolve) => {
    const request = https.request({ hostname: "127.0.0.1", port: 2999, path: endpoint, method: "GET", rejectUnauthorized: false, timeout: 1_500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) return resolve({ unavailable: true, status: response.statusCode });
        try { resolve(JSON.parse(body)); } catch { resolve({ malformed: true, status: response.statusCode }); }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", (error) => resolve({ unavailable: true, error: error.message }));
    request.end();
  });
}

function matchingPaths(value: unknown): Array<{ path: string; value: unknown }> {
  const matches: Array<{ path: string; value: unknown }> = [];
  const visit = (current: unknown, currentPath: string, depth: number) => {
    if (current == null || depth > 12) return;
    if (Array.isArray(current)) { current.forEach((entry, index) => visit(entry, `${currentPath}[${index}]`, depth + 1)); return; }
    if (typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as JsonRecord)) {
      const childPath = `${currentPath}.${key}`;
      if (/(augment|perk|rune|cherry)/i.test(key) || (typeof child === "string" && /(augment|perk|rune|cherry)/i.test(child))) {
        matches.push({ path: childPath, value: child });
      }
      visit(child, childPath, depth + 1);
    }
  };
  visit(value, "root", 0);
  return matches;
}

async function main() {
  const durationSeconds = argument("duration", 60);
  const intervalSeconds = argument("interval", 5);
  const connector = new ClientConnector();
  connector.start();
  const deadline = Date.now() + durationSeconds * 1_000;
  const captures: unknown[] = [];
  fs.mkdirSync(path.join(process.cwd(), "logs"), { recursive: true });

  try {
    while (Date.now() < deadline) {
      const connection = connector.snapshot();
      const [phase, gameflow, activePlayer, playerList, allGameData] = await Promise.all([
        connection.connected ? connector.requestJson("/lol-gameflow/v1/gameflow-phase").catch((error: Error) => ({ unavailable: true, error: error.message })) : null,
        connection.connected ? connector.requestJson("/lol-gameflow/v1/session").catch((error: Error) => ({ unavailable: true, error: error.message })) : null,
        liveJson("/liveclientdata/activeplayer"),
        liveJson("/liveclientdata/playerlist"),
        liveJson("/liveclientdata/allgamedata"),
      ]);
      const payload = { phase, gameflow, activePlayer, playerList, allGameData };
      captures.push({
        capturedAt: new Date().toISOString(),
        connection,
        detectedAugmentRefs: extractOwnedAugmentRefs(allGameData),
        matchingPaths: matchingPaths(payload),
        payload,
      });
      fs.writeFileSync(path.join(process.cwd(), "logs", "lcu_dump.json"), JSON.stringify({ generatedAt: new Date().toISOString(), captures }, null, 2));
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
    }
  } finally {
    await connector.stop();
  }
  const last = captures.at(-1) as { detectedAugmentRefs?: string[]; matchingPaths?: unknown[] } | undefined;
  console.log(JSON.stringify({ output: "logs/lcu_dump.json", captures: captures.length, detectedAugmentRefs: last?.detectedAugmentRefs ?? [], matchingPathCount: last?.matchingPaths?.length ?? 0 }, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
