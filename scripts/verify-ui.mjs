import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const output = path.join(root, "qa");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
});

const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.getByText("Conversion paths", { exact: true }).waitFor();
  const desktopCombos = await page.locator(".combo-card").count();
  assert(desktopCombos >= 9);
  assert(await page.getByText("Video-derived build lead", { exact: true }).count() > 0);

  await page.locator("#champion").selectOption("Sion");
  await page.getByRole("button", { name: "Max HP", exact: true }).click();
  await page.getByText("660k HP Sion Heartstack Foundry", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "sion-health.png"), fullPage: true });

  await page.locator("nav button", { hasText: "Video evidence" }).click();
  await page.getByText(/660k Max HP Sion/, { exact: false }).waitFor();
  const sionVideoCards = await page.locator(".video-card").count();
  assert(sionVideoCards >= 2);
  await page.screenshot({ path: path.join(output, "sion-videos.png"), fullPage: true });

  await page.locator("nav button", { hasText: "Augments" }).click();
  await page.locator("#champion").selectOption("");
  await page.getByRole("button", { name: "Any ceiling", exact: true }).click();
  await page.locator("#search").fill("Mind to Matter");
  await page.getByRole("heading", { name: "Mind to Matter", exact: true }).waitFor();
  const augmentSearchResults = await page.locator(".entity-card").count();
  assert.equal(augmentSearchResults, 1);
  await page.getByRole("button", { name: "Find matching build paths", exact: false }).click();
  await page.getByText("Mana-to-Meat Conversion", { exact: true }).waitFor();

  const csvResponse = await page.request.get("http://localhost:3000/api/export?kind=augment");
  assert.equal(csvResponse.status(), 200);
  assert.match(csvResponse.headers()["content-type"], /text\/csv/);

  const ownedPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  ownedPage.on("pageerror", (error) => errors.push(error.message));
  await ownedPage.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await ownedPage.locator("#champion").selectOption("Yunara");
  await ownedPage.locator("#owned-entity").selectOption("item:443069");
  await ownedPage.getByText("Hamstringer + Vulnerability (3 recorded runs)", { exact: true }).waitFor();
  const ownedCards = ownedPage.locator(".combo-card");
  assert.equal(await ownedPage.getByText(/Caitlyn Headshot/, { exact: false }).count(), 0);
  assert((await ownedCards.count()) > 5);
  for (const card of await ownedCards.all()) {
    assert((await card.locator(".combo-entity", { hasText: "Hamstringer" }).count()) > 0);
  }
  await ownedPage.screenshot({ path: path.join(output, "yunara-hamstringer.png"), fullPage: true });

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobilePage.on("pageerror", (error) => errors.push(error.message));
  await mobilePage.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await mobilePage.getByText("Conversion paths", { exact: true }).waitFor();
  const mobileDimensions = await mobilePage.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert(mobileDimensions.document <= mobileDimensions.viewport);
  await mobilePage.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    desktopCombos,
    sionVideoCards,
    augmentSearchResults,
    csvExportStatus: csvResponse.status(),
    yunaraHamstringerCards: await ownedCards.count(),
    mobileDimensions,
    consoleErrors: errors.length,
  }, null, 2));
} finally {
  await browser.close();
}
