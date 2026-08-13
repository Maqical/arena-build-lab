import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const appDb = path.join(process.env.APPDATA ?? "", "Arena Build Lab", "data", "arena.sqlite");
const database = path.resolve(process.env.ARENA_DB_PATH ?? (fs.existsSync(appDb) ? appDb : "data/arena.sqlite"));
const port = Number(process.env.ARENA_STRESS_PORT ?? 3231);
const server = spawn(process.execPath, [path.resolve(".next/standalone/server.js")], { cwd: path.resolve(".next/standalone"), env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", ARENA_DB_PATH: database, ARENA_EXTREME_CSV_PATH: path.resolve("data/extreme_builds.csv") }, windowsHide: true, stdio: "ignore" });

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Stress-test server did not start.");
}

async function main(): Promise<void> {
try {
  await waitForServer();
  const db = new DatabaseSync(database, { readOnly: true });
  const totalMatches = Number((db.prepare("SELECT COUNT(*) count FROM riot_matches").get() as Record<string, unknown>).count);
  assert(totalMatches >= Number(process.env.ARENA_STRESS_MIN_MATCHES ?? 1_000), `Expected 1,000 matches, found ${totalMatches}.`);
  const recommendationSeed = db.prepare(`SELECT rp.champion_id, pa.augment_id, COUNT(*) sample_size FROM riot_participants rp JOIN participant_augments pa ON pa.match_id=rp.match_id AND pa.participant_index=rp.participant_index GROUP BY rp.champion_id, pa.augment_id HAVING COUNT(*)>=20 ORDER BY sample_size DESC LIMIT 1`).get() as Record<string, unknown> | undefined;
  db.close();
  assert(recommendationSeed, "No champion + augment pair has a 20-game recommendation sample.");

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
    const historyStarted = performance.now();
    await page.goto(`http://127.0.0.1:${port}/history?scope=all`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(`${Math.min(totalMatches, 1_000)} games`, { exact: true }).waitFor();
    const historyMs = performance.now() - historyStarted;
    assert(historyMs < 5_000, `History took ${historyMs.toFixed(0)}ms to render.`);
    const historyCards = await page.locator(".history-card").count();
    assert.equal(historyCards, 20, "History should render exactly one 20-match page for a populated warehouse.");
    const extremeStarted = performance.now();
    await page.goto(`http://127.0.0.1:${port}/extreme-builds`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Extreme Build Browser" }).waitFor();
    const extremeMs = performance.now() - extremeStarted;
    assert(extremeMs < 5_000, `Extreme Builds took ${extremeMs.toFixed(0)}ms to render.`);
    const response = await page.request.get(`http://127.0.0.1:${port}/api/augment-builds?championId=${recommendationSeed.champion_id}&augmentIds=${recommendationSeed.augment_id}`);
    assert.equal(response.status(), 200);
    const recommendation = await response.json() as { source: string; sampleSize: number; items: unknown[] };
    assert.equal(recommendation.source, "observed");
    assert(recommendation.sampleSize >= 20);
    assert(recommendation.items.length > 0);
    assert.deepEqual(errors, []);
    const report = { totalMatches, historyCards, historyMilliseconds: historyMs, extremeMilliseconds: extremeMs, recommendationSample: recommendation.sampleSize, recommendationItems: recommendation.items.length, consoleErrors: errors.length };
    fs.mkdirSync(path.resolve("qa"), { recursive: true });
    fs.writeFileSync(path.resolve("qa/stress-ui-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
} finally {
  server.kill();
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
