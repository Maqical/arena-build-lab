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

  const overlayPage = await browser.newPage({ viewport: { width: 420, height: 720 }, deviceScaleFactor: 1 });
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
  assert(overlayDimensions.component <= 420);
  await overlayPage.screenshot({ path: path.join(output, "live-overlay-demo.png"), fullPage: true });

  const extremePage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  extremePage.on("pageerror", (error) => errors.push(error.message));
  await extremePage.goto("http://localhost:3000/extreme-builds", { waitUntil: "networkidle" });
  await extremePage.getByRole("heading", { name: "Extreme Build Browser", exact: true }).waitFor();
  await extremePage.getByLabel("Champion filter").selectOption({ label: "Sion" });
  await extremePage.getByText("658,207", { exact: true }).first().waitFor();
  const sionExtremeRows = await extremePage.locator(".extreme-row:not(.extreme-table-head)").count();
  assert(sionExtremeRows >= 20);
  await extremePage.getByRole("button", { name: "Copy build", exact: true }).first().click();
  await extremePage.getByRole("button", { name: "Copied", exact: true }).waitFor();
  await extremePage.screenshot({ path: path.join(output, "extreme-builds.png"), fullPage: true });

  const championSelectPage = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
  championSelectPage.on("pageerror", (error) => errors.push(error.message));
  await championSelectPage.goto("http://localhost:3000/champ-select", { waitUntil: "domcontentloaded" });
  const previewChampion = championSelectPage.getByLabel("Preview champion");
  await previewChampion.waitFor();
  await championSelectPage.locator('.champ-select-assistant[data-hydrated="true"]').waitFor();
  await previewChampion.selectOption({ label: "Sion" });
  await championSelectPage.locator(".champ-extreme").getByText(/658,207 HP/).waitFor();
  assert(await championSelectPage.locator(".champ-duos article").count() >= 3);
  assert(await championSelectPage.locator(".champ-picks article").count() >= 4);
  await championSelectPage.screenshot({ path: path.join(output, "champ-select-assistant.png"), fullPage: true });

  const champOverlayPage = await browser.newPage({ viewport: { width: 420, height: 720 }, deviceScaleFactor: 1 });
  champOverlayPage.on("pageerror", (error) => errors.push(error.message));
  await champOverlayPage.goto("http://localhost:3000/overlay?demo=champ-select", { waitUntil: "domcontentloaded" });
  await champOverlayPage.getByText("Live Arena hover / lock", { exact: true }).waitFor();
  await champOverlayPage.locator(".champ-extreme").getByText(/658,207 HP/).waitFor();
  assert.equal(await champOverlayPage.getByRole("button", { name: /Paste augment snip/ }).count(), 1);
  await champOverlayPage.screenshot({ path: path.join(output, "champ-select-overlay.png"), fullPage: true });

  const disconnectedPage = await browser.newPage({ viewport: { width: 420, height: 720 }, deviceScaleFactor: 1 });
  disconnectedPage.on("pageerror", (error) => errors.push(error.message));
  await disconnectedPage.goto("http://localhost:3000/overlay?demo=disconnected", { waitUntil: "domcontentloaded" });
  await disconnectedPage.getByText("Waiting for League Client…", { exact: true }).waitFor();
  assert.equal(await disconnectedPage.locator(".overlay-connection-wait").count(), 1);

  const hotkeyPage = await browser.newPage({ viewport: { width: 420, height: 720 }, deviceScaleFactor: 1 });
  await hotkeyPage.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: async () => [{ types: ["image/png"], getType: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }) }] } });
  });
  await hotkeyPage.route("**/api/ai-picker", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      champion: { key: "Sion", name: "Sion" }, level: 18, opponent: "Arena lobby", baseline: {},
      options: [
        { entity: { entityKey: "augment:41", name: "Goliath", kind: "augment", rarity: "prismatic", description: "Health and adaptive force.", iconUrl: "", executable: true }, deltas: { maxHealth: 1267, totalAttackDamage: 100.4, abilityPower: 0 }, resolved: {}, localScore: 100 },
        { entity: { entityKey: "augment:313", name: "Tank Engine", kind: "augment", rarity: "gold", description: "Health per takedown.", iconUrl: "", executable: true }, deltas: { maxHealth: 800, totalAttackDamage: 24, abilityPower: 0 }, resolved: {}, localScore: 80 },
        { entity: { entityKey: "augment:56", name: "Mind to Matter", kind: "augment", rarity: "silver", description: "Mana to health.", iconUrl: "", executable: true }, deltas: { maxHealth: 500, totalAttackDamage: 15, abilityPower: 0 }, resolved: {}, localScore: 70 },
      ],
      recommendation: { entityKey: "augment:41", name: "Goliath", rationale: "Best screenshot-derived health conversion for this benchmark.", confidence: .94 },
      provider: "openai", model: "ui-test", warning: "", screenshotExtracted: true,
    }),
  }));
  await hotkeyPage.goto("http://localhost:3000/overlay?demo=screenshot", { waitUntil: "domcontentloaded" });
  await hotkeyPage.getByRole("button", { name: /Paste augment snip/ }).waitFor();
  await hotkeyPage.locator(".overlay-champion").getByText("Sion", { exact: true }).waitFor();
  await hotkeyPage.keyboard.press("Control+Shift+A");
  await hotkeyPage.getByText("Screenshot offers", { exact: true }).waitFor();
  await hotkeyPage.getByText("Best screenshot-derived health conversion", { exact: false }).waitFor();
  await hotkeyPage.screenshot({ path: path.join(output, "screenshot-hotkey-overlay.png"), fullPage: true });

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
    sionExtremeRows,
    championSelectDuos: await championSelectPage.locator(".champ-duos article").count(),
    championSelectAugments: await championSelectPage.locator(".champ-picks article").count(),
    screenshotShortcutControls: 1,
    screenshotHotkeyResult: "Goliath",
    consoleErrors: errors.length,
  }, null, 2));
} finally {
  await browser.close();
}
