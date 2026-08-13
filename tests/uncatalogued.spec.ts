import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { resolveArenaBuild } from "../src/engine/resolver";
import { parseRiotMatch } from "../src/lib/riot/arena-match";
import { insertParsedMatch } from "../src/lib/riot/ingestion";
import { SCHEMA_SQL } from "../src/lib/schema";

const fixturePath = path.resolve("tests/fixtures/sanitized_brand_match.json");
const catalogDatabase = path.resolve("data/arena.sqlite");
const port = Number(process.env.ARENA_UNCATALOGUED_PORT ?? 3232);

function seedDatabase(filename: string): void {
  if (!fs.existsSync(catalogDatabase)) throw new Error("Run npm run data:sync before the uncatalogued-selection test.");
  fs.copyFileSync(catalogDatabase, filename);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA_SQL);
  const parsed = parseRiotMatch(fixture, { routingRegion: "americas", platform: "na1" });
  assert.equal(insertParsedMatch(db, parsed), true);
  db.prepare(`
    INSERT INTO live_observations(
      puuid, champion_id, champion_name, augment_ids_json, observed_max_hp,
      observed_max_ad, observed_max_ap, observed_max_as, observed_max_armor,
      observed_max_mr, observed_max_ms, observed_max_haste, queue_id, started_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sanitized-puuid-brand", 63, "Brand", JSON.stringify(["augment:1", "augment:66", "augment:301", "augment:379", "augment:308", "augment:999999"]),
    4187, 128, 1024, 2.1, 189, 164, 427, 211, 1740,
    "2026-08-13T00:00:00.000Z", "2026-08-13T00:32:22.000Z",
  );
  db.close();
}

function verifyResolverDiagnostic(): void {
  const diagnostics: string[] = [];
  const result = resolveArenaBuild({
    championId: 63,
    level: 18,
    augmentIds: ["999999"],
    catalog: {
      champions: [{
        id: 63,
        key: "Brand",
        name: "Brand",
        stats: {
          health: 590, healthPerLevel: 102, mana: 469, manaPerLevel: 21,
          attackDamage: 57, attackDamagePerLevel: 3, attackSpeed: 0.625,
          attackSpeedPerLevel: 1.36, armor: 22, armorPerLevel: 4.7,
          magicResistance: 30, magicResistancePerLevel: 1.3, moveSpeed: 340,
        },
      }],
      effects: [],
    },
    options: { onDiagnostic: (message) => diagnostics.push(message) },
  });
  assert.deepEqual(diagnostics, ["Ignored uncatalogued selection ID: 999999"]);
  assert.deepEqual(result.effects, []);
  assert(result.warnings.includes("Ignored uncatalogued selection ID: 999999"));
}

async function waitForServer(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`Test server exited with code ${server.exitCode}.`);
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch { /* Retry while Next boots. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Uncatalogued-selection test server did not start.");
}

async function main(): Promise<void> {
  verifyResolverDiagnostic();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arena-uncatalogued-"));
  const database = path.join(tempRoot, "arena.sqlite");
  seedDatabase(database);
  const server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      ARENA_DB_PATH: database,
      ARENA_EXTREME_CSV_PATH: path.resolve("data/extreme_builds.csv"),
    },
    windowsHide: true,
    stdio: "ignore",
  });
  try {
    await waitForServer(server);
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    const errors: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

      await page.goto(`http://127.0.0.1:${port}/history?scope=all`, { waitUntil: "domcontentloaded" });
      const brandCard = page.locator(".history-card").filter({ hasText: "Brand" }).first();
      await brandCard.waitFor();
      await brandCard.getByText("Wild Fire", { exact: true }).waitFor();
      await brandCard.getByText("Uncatalogued selection (ID: 999999)", { exact: true }).waitFor();

      const postGame = await page.request.get(`http://127.0.0.1:${port}/api/post-game-analysis?champion=Brand`);
      assert.equal(postGame.status(), 200);
      const postGameJson = await postGame.json() as { analysis: { picked: string[] } | null };
      assert(postGameJson.analysis?.picked.includes("Wild Fire"));
      assert(postGameJson.analysis?.picked.includes("Uncatalogued selection (ID: 999999)"));

      const recommendations = await page.request.get(`http://127.0.0.1:${port}/api/augment-builds?championId=63&augmentIds=999999`);
      assert.equal(recommendations.status(), 200);
      const recommendationJson = await recommendations.json() as { augmentIds: number[]; augmentNames: string[] };
      assert.deepEqual(recommendationJson.augmentIds, [999999]);
      assert.deepEqual(recommendationJson.augmentNames, ["Uncatalogued selection (ID: 999999)"]);

      await page.goto(`http://127.0.0.1:${port}/overlay?demo=uncatalogued`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
      assert.equal(await page.locator(".live-game-hud").count(), 1, `Live HUD did not render. Page text: ${(await page.locator("body").innerText()).slice(0, 1_000)}`);
      await page.getByText("Uncatalogued selection (ID: 999999)", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    if (server.exitCode == null) {
      server.kill();
      await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    const resolvedTemp = path.resolve(tempRoot);
    if (resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
