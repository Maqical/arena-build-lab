import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";

const baseUrl = process.env.ARENA_BASE_URL ?? "http://127.0.0.1:3210";

async function minimumVisibleTextSize(page: Page, root: string): Promise<number> {
  return page.locator(root).evaluate((element) => {
    const sizes = [...element.querySelectorAll<HTMLElement>("*")].flatMap((node) => {
      if (!node.textContent?.trim() || node.children.length > 0) return [];
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || bounds.width === 0 || bounds.height === 0) return [];
      return [Number.parseFloat(style.fontSize)];
    });
    return sizes.length ? Math.min(...sizes) : 0;
  });
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

    await page.goto(`${baseUrl}/live?demo=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Live game" }).waitFor();
    await page.getByText("Sion", { exact: true }).first().waitFor();
    const liveMinimum = await minimumVisibleTextSize(page, ".live-companion-page");
    assert(liveMinimum >= 12, `Live page contains ${liveMinimum}px visible text`);

    const started = Date.now();
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.getByRole("heading", { name: "Match History" }).waitFor({ timeout: 5_000 });
    const historyTransitionMs = Date.now() - started;
    assert(historyTransitionMs < 2_500, `History navigation took ${historyTransitionMs}ms`);
    const historyMinimum = await minimumVisibleTextSize(page, ".history-shell");
    assert(historyMinimum >= 11, `History contains ${historyMinimum}px visible text`);

    const settingsStarted = Date.now();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 5_000 });
    const settingsTransitionMs = Date.now() - settingsStarted;
    assert(settingsTransitionMs < 2_500, `Settings navigation took ${settingsTransitionMs}ms`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ liveMinimum, historyMinimum, historyTransitionMs, settingsTransitionMs, consoleErrors: errors.length }, null, 2));
  } finally {
    await browser.close();
  }
}

void main();
