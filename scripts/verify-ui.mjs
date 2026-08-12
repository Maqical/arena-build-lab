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

  const extremeResponse = await page.request.get("http://localhost:3000/api/extreme-builds?champion=Sion&objective=maxHealth&limit=2");
  assert.equal(extremeResponse.status(), 200);
  const extremePayload = await extremeResponse.json();
  assert.equal(extremePayload.builds.length, 2);
  assert.equal(extremePayload.builds[0].theoreticalUnbounded, true);
  assert(extremePayload.builds[0].score > 650000);

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

  await page.locator("nav button", { hasText: "Stat Lab" }).click();
  await page.getByRole("heading", { name: "Stat Conversion Lab", exact: true }).waitFor();
  await page.getByLabel("Max health").fill("2000");
  await page.getByLabel("Bonus health").fill("500");
  await page.getByLabel("Max mana").fill("1000");
  await page.getByRole("button", { name: /Mind to Matter/ }).click();
  await page.getByRole("button", { name: /Overlord's Bloodmail/ }).click();
  assert.match(await page.locator('[data-stat-key="maxHealth"]').innerText(), /2,350/);
  assert.match(await page.locator('[data-stat-key="bonusAttackDamage"]').innerText(), /25\.5/);
  assert.equal(await page.locator(".calculation-trace > div").count(), 2);
  await page.screenshot({ path: path.join(output, "stat-lab.png"), fullPage: true });

  await page.locator("nav button", { hasText: "My runs" }).click();
  await page.getByRole("heading", { name: "My Arena Runs", exact: true }).waitFor();
  await page.locator(".run-form select").nth(0).selectOption({ label: "Yunara" });
  await page.getByText("Teams", { exact: true }).locator("..").getByRole("spinbutton").fill("8");
  await page.getByText("Placement", { exact: true }).locator("..").getByRole("spinbutton").fill("2");
  await page.locator(".run-entity-picker select").selectOption({ label: "Hamstringer" });
  await page.locator(".run-entity-picker select").selectOption({ label: "Vulnerability" });
  await page.locator(".notes-field textarea").fill("Automated UI verification entry");
  await page.getByRole("button", { name: "Save run", exact: true }).click();
  await page.getByText("Run saved locally.", { exact: true }).waitFor();
  await page.getByText("Yunara · #2 of 8", { exact: true }).waitFor();
  assert(await page.locator(".performance-name", { hasText: "Hamstringer" }).count() > 0);
  const runPayload = await page.request.get("http://localhost:3000/api/personal-runs").then((response) => response.json());
  const verificationRun = runPayload.runs.find((run) => run.notes === "Automated UI verification entry");
  assert(verificationRun);
  const deleteResponse = await page.request.delete(`http://localhost:3000/api/personal-runs/${verificationRun.id}`);
  assert.equal(deleteResponse.status(), 204);
  await page.screenshot({ path: path.join(output, "my-runs.png"), fullPage: true });

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

  const overlayPage = await browser.newPage({ viewport: { width: 300, height: 600 }, deviceScaleFactor: 1 });
  overlayPage.on("pageerror", (error) => errors.push(error.message));
  overlayPage.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await overlayPage.goto("http://localhost:3000/overlay?demo=1", { waitUntil: "domcontentloaded" });
  await overlayPage.getByText("Choose an augment", { exact: true }).waitFor();
  await overlayPage.locator(".overlay-offers article").first().waitFor();
  assert.equal(await overlayPage.locator(".overlay-offers article").count(), 3);
  await overlayPage.locator(".overlay-verdict").waitFor();
  assert(await overlayPage.getByText("Craze Factor", { exact: true }).count() > 0);
  await overlayPage.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 10_000 });
  const overlayImageStates = await overlayPage.locator("img").evaluateAll((images) => images.map((image) => ({
    alt: image.alt,
    loaded: image.naturalWidth > 0,
    source: image.getAttribute("src") ?? "",
  })));
  const overlayDimensions = await overlayPage.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    component: Math.round(document.querySelector(".overlay-page")?.getBoundingClientRect().width ?? 0),
  }));
  assert(overlayDimensions.document <= overlayDimensions.viewport);
  assert(overlayDimensions.component <= 300);
  await overlayPage.screenshot({ path: path.join(output, "live-overlay-demo.png"), fullPage: true });

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    desktopCombos,
    sionVideoCards,
    augmentSearchResults,
    csvExportStatus: csvResponse.status(),
    extremeBuildApiStatus: extremeResponse.status(),
    yunaraHamstringerCards: await ownedCards.count(),
    statLabSteps: 2,
    personalRunApi: deleteResponse.status(),
    mobileDimensions,
    overlayDimensions,
    overlayOffers: 3,
    overlayImagesLoaded: overlayImageStates.filter((image) => image.loaded).length,
    overlayImagesTotal: overlayImageStates.length,
    consoleErrors: errors.length,
  }, null, 2));
} finally {
  await browser.close();
}
