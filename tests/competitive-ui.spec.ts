import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.ARENA_BASE_URL ?? "http://127.0.0.1:3210";
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors: string[] = [];
  try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${baseUrl}/tier-list?region=na`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Dynamic Tier List" }).waitFor();
  assert.equal(await page.locator(".tier-row").count(), 5);
  assert(await page.locator(".tier-champion").count() > 0);
  await page.getByRole("link", { name: "KR", exact: true }).click();
  await page.getByText("No KR snapshot yet", { exact: true }).waitFor();

  await page.goto(`${baseUrl}/matchups?region=na&championId=14`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sion Matchups" }).waitFor();
  assert(await page.locator(".matchup-grid article").count() > 0);

  await page.goto(`${baseUrl}/duos?region=na&championId=14`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sion Duo Lab" }).waitFor();
  assert(await page.locator(".duo-grid article").count() > 0);

  await page.goto(`${baseUrl}/trends?region=na`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Meta Trends" }).waitFor();
  await page.getByRole("button", { name: "Copy Meta Report" }).waitFor();

  await page.goto(`${baseUrl}/pros?region=global`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Pro & High-Elo Watch" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ tierChampions: await page.request.get(`${baseUrl}/api/insights?kind=tier&region=na`).then(async (response) => (await response.json()).rows.length), consoleErrors: errors.length }, null, 2));
  } finally { await browser.close(); }
}
void main();
