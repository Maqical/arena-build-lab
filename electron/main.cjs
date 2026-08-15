/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, desktopCapturer, clipboard, nativeImage, screen, ipcMain, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { OVERLAY_BASE_WIDTH, OVERLAY_BASE_HEIGHT, normalizedBounds, defaultOverlayBounds: makeDefaultOverlayBounds, visibleOverlayBounds: restoreVisibleBounds } = require("./window-state.cjs");
const { detectAugmentSelectionFrame, cardIndexAtPoint } = require("./visual-selection-detector.cjs");

app.setName("Arena Build Lab");

const PORT = Number(process.env.ARENA_ELECTRON_PORT || 3210);
const OBS_MODE = process.argv.includes("--obs");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let serverProcess;
let mainWindow;
let dashboardWindow;
let tray;
let appearance = { opacity: 1, scale: 1 };
let dataInitializing = false;
let windowMode = "overlay";
let applyingWindowBounds = false;
let boundsSaveTimer;
let visualWatcherTimer;
let visualPollBusy = false;
let visualScanInFlight = false;
let visualDetectedFrames = 0;
let visualMissingFrames = 0;
let visualSession = null;
let visualCatalogPromise;
let notificationTimer;
let patchNotifiedVersion = "";
let trackedPlayerTimer;
let trackedPlayerSyncBusy = false;
const settingsPath = () => path.join(app.getPath("userData"), "user_settings.json");

function defaultSettings() {
  return { riotId: "", riotApiKey: process.env.RIOT_API_KEY || "", openAiApiKey: process.env.OPENAI_API_KEY || "", twitchClientId: process.env.TWITCH_CLIENT_ID || "", twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "", twitchLogins: process.env.ARENA_TWITCH_LOGINS || "", opacity: 1, scale: 1, openAtLogin: false, notifyProMatches: true, notifyPatch: true, notifyRecords: true, overlayBounds: null };
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { riotId: String(value.riotId ?? ""), riotApiKey: String(value.riotApiKey ?? ""), openAiApiKey: String(value.openAiApiKey ?? ""), twitchClientId: String(value.twitchClientId ?? ""), twitchClientSecret: String(value.twitchClientSecret ?? ""), twitchLogins: String(value.twitchLogins ?? ""), opacity: Number(value.opacity ?? 1), scale: Number(value.scale ?? 1), openAtLogin: Boolean(value.openAtLogin), notifyProMatches: value.notifyProMatches !== false, notifyPatch: value.notifyPatch !== false, notifyRecords: value.notifyRecords !== false, overlayBounds: normalizedBounds(value.overlayBounds) };
  } catch { return defaultSettings(); }
}

function writeSettings(next) {
  const current = readSettings();
  const value = { ...current, ...next, opacity: Math.min(1, Math.max(0, Number(next.opacity ?? current.opacity))), scale: Math.min(1.5, Math.max(.75, Number(next.scale ?? current.scale))), overlayBounds: normalizedBounds(next.overlayBounds ?? current.overlayBounds) };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2), "utf8");
  return value;
}

function defaultOverlayBounds(scale = appearance.scale) {
  return makeDefaultOverlayBounds(screen.getPrimaryDisplay().workArea, scale);
}

function visibleOverlayBounds(saved, scale = appearance.scale) {
  return restoreVisibleBounds(saved, [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter((display) => display.id !== screen.getPrimaryDisplay().id)], scale);
}

function persistOverlayBoundsSoon() {
  if (windowMode !== "overlay" || applyingWindowBounds || !mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = undefined;
    if (windowMode === "overlay" && mainWindow && !mainWindow.isDestroyed()) writeSettings({ overlayBounds: mainWindow.getBounds() });
  }, 250);
}

function setWindowBounds(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  applyingWindowBounds = true;
  mainWindow.setBounds(bounds);
  applyingWindowBounds = false;
}

function resetOverlayPosition() {
  const bounds = defaultOverlayBounds();
  writeSettings({ overlayBounds: bounds });
  if (mainWindow && !mainWindow.isDestroyed()) {
    windowMode = "overlay";
    setWindowBounds(bounds);
    openOverlay();
  }
}

function rootPath(...parts) { return path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."), ...parts); }

function appIconPath() {
  return rootPath("assets", "arena-build-lab-v2-icon.png");
}

function prepareUserData() {
  const destination = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(destination, { recursive: true });
  const source = rootPath("data", "arena.sqlite");
  const target = path.join(destination, "arena.sqlite");
  if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
  return target;
}

function packagedWorker(name) {
  return rootPath("workers", name);
}

function spawnWorker(worker) {
  const settings = readSettings();
  const env = { ...process.env, RIOT_API_KEY: settings.riotApiKey, OPENAI_API_KEY: settings.openAiApiKey, ARENA_DB_PATH: path.join(app.getPath("userData"), "data", "arena.sqlite"), ARENA_EXTREME_CSV_PATH: rootPath("data", "extreme_builds.csv"), ARENA_PRO_SEEDS_PATH: rootPath("data", "pro_players.seed.json") };
  if (app.isPackaged) {
    if (worker === "youtube") return { child: spawn(packagedWorker("arena-youtube-sync.exe"), ["--database", env.ARENA_DB_PATH, "--details-limit", "20", "--transcripts"], { env, windowsHide: true, stdio: "ignore" }), exitEvent: "close" };
    const script = worker === "riot" ? packagedWorker("riot-sync.cjs") : worker === "pros" ? packagedWorker("pro-sync.cjs") : packagedWorker("data-sync.cjs");
    const args = worker === "riot" && settings.riotId.trim() ? [`--player=${settings.riotId.trim()}`] : [];
    return { child: utilityProcess.fork(script, args, { env, cwd: app.getPath("userData"), stdio: "ignore", serviceName: `Arena ${worker} worker` }), exitEvent: "exit" };
  }
  const command = worker === "youtube" ? "youtube:sync" : worker === "riot" ? "riot:sync" : worker === "pros" ? "pros:sync" : "data:sync";
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["run", command];
  if (worker === "riot" && settings.riotId.trim()) args.push("--", `--player=${settings.riotId.trim()}`);
  return { child: spawn(npm, args, { cwd: path.resolve(__dirname, ".."), env, detached: true, stdio: "ignore", windowsHide: true }), exitEvent: "close" };
}

function initializeDataIfNeeded() {
  const database = prepareUserData();
  if (fs.existsSync(database) || dataInitializing) return;
  dataInitializing = true;
  const worker = spawnWorker("data");
  worker.child.on(worker.exitEvent, () => { dataInitializing = false; if (mainWindow && !mainWindow.isDestroyed()) openOverlay(); });
}

function seedVideoCatalogIfNeeded() {
  const seed = rootPath("data", "videos.seed.sqlite");
  if (!fs.existsSync(seed)) return;
  const env = { ...process.env, ARENA_DB_PATH: path.join(app.getPath("userData"), "data", "arena.sqlite"), ARENA_VIDEO_SEED_PATH: seed, ARENA_EXTREME_CSV_PATH: rootPath("data", "extreme_builds.csv") };
  if (app.isPackaged) {
    const worker = utilityProcess.fork(packagedWorker("seed-data.cjs"), [], { env, cwd: app.getPath("userData"), stdio: "ignore", serviceName: "Arena seed worker" });
    worker.once("exit", () => {});
  } else {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(npx, ["tsx", path.join(__dirname, "..", "scripts", "seed-video-catalog.ts")], { cwd: path.resolve(__dirname, ".."), env, detached: true, stdio: "ignore", windowsHide: true });
    child.once("close", () => {});
  }
}

function startNext() {
  const settings = readSettings();
  const env = { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", ARENA_DB_PATH: prepareUserData(), ARENA_EXTREME_CSV_PATH: rootPath("data", "extreme_builds.csv"), NEXT_TELEMETRY_DISABLED: "1", RIOT_API_KEY: settings.riotApiKey, OPENAI_API_KEY: settings.openAiApiKey, TWITCH_CLIENT_ID: settings.twitchClientId, TWITCH_CLIENT_SECRET: settings.twitchClientSecret, ARENA_TWITCH_LOGINS: settings.twitchLogins };
  if (app.isPackaged) {
    serverProcess = utilityProcess.fork(rootPath("standalone", "server.js"), [], { cwd: rootPath("standalone"), env, stdio: "ignore", serviceName: "Arena local server" });
  } else {
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { cwd: process.cwd(), env, stdio: "ignore", shell: false });
  }
}

async function restartNext() {
  if (serverProcess) {
    const previous = serverProcess;
    const stopped = new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      const done = () => { clearTimeout(timer); resolve(); };
      previous.once?.("exit", done);
      previous.once?.("close", done);
    });
    previous.kill();
    await stopped;
  }
  startNext();
  await waitForServer();
}

function applyAppearance(next, resizeWindow = true) {
  appearance = { opacity: Math.min(1, Math.max(0, Number(next.opacity))), scale: Math.min(1.5, Math.max(.75, Number(next.scale))) };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(appearance.opacity);
    if (resizeWindow && windowMode === "overlay") {
      const bounds = mainWindow.getBounds();
      setWindowBounds({ ...bounds, width: Math.round(OVERLAY_BASE_WIDTH * appearance.scale), height: Math.round(OVERLAY_BASE_HEIGHT * appearance.scale) });
    }
    if (windowMode === "overlay") writeSettings({ opacity: appearance.opacity, scale: appearance.scale, overlayBounds: mainWindow.getBounds() });
    void mainWindow.webContents.executeJavaScript(`document.documentElement.style.zoom = ${appearance.scale}`);
  }
  return { ok: true };
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const probe = () => {
      const request = http.get(`http://127.0.0.1:${PORT}/overlay`, (response) => {
        response.resume();
        if ((response.statusCode ?? 500) < 500) resolve();
        else if (Date.now() - started > 30_000) reject(new Error(`Arena Build Lab server returned HTTP ${response.statusCode}.`));
        else setTimeout(probe, 250);
      });
      request.on("error", () => {
        if (Date.now() - started > 30_000) reject(new Error("Arena Build Lab server did not start."));
        else setTimeout(probe, 250);
      });
    };
    probe();
  });
}

function forwardProviderEvent(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const request = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/lcu/provider-event", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length }, timeout: 2_000 });
  request.on("error", () => {});
  request.on("timeout", () => request.destroy());
  request.end(body);
}

function localJson(pathname, method = "GET", payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const request = http.request({
      hostname: "127.0.0.1",
      port: PORT,
      path: pathname,
      method,
      headers: body ? { "Content-Type": "application/json", "Content-Length": body.length } : undefined,
      timeout: 15_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if ((response.statusCode ?? 500) >= 400) reject(new Error(String(result.error || `HTTP ${response.statusCode}`)));
          else resolve(result);
        } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Local companion request timed out.")));
    if (body) request.write(body);
    request.end();
  });
}

function resetVisualSession() {
  visualDetectedFrames = 0;
  visualMissingFrames = 0;
  visualSession = null;
}

function pixelGray(bitmap, offset) {
  return (Number(bitmap[offset]) + Number(bitmap[offset + 1]) + Number(bitmap[offset + 2])) / 3;
}

function maskedCorrelation(screenBitmap, templateBitmap, minimumTemplateGray = 12) {
  let count = 0;
  let sumScreen = 0;
  let sumTemplate = 0;
  let sumScreen2 = 0;
  let sumTemplate2 = 0;
  let sumProduct = 0;
  const length = Math.min(screenBitmap.length, templateBitmap.length);
  for (let offset = 0; offset + 3 < length; offset += 4) {
    const templateGray = pixelGray(templateBitmap, offset);
    const alpha = Number(templateBitmap[offset + 3]);
    if (alpha < 20 || templateGray < minimumTemplateGray) continue;
    const screenGray = pixelGray(screenBitmap, offset);
    count += 1;
    sumScreen += screenGray;
    sumTemplate += templateGray;
    sumScreen2 += screenGray * screenGray;
    sumTemplate2 += templateGray * templateGray;
    sumProduct += screenGray * templateGray;
  }
  if (count < 50) return -1;
  const numerator = count * sumProduct - sumScreen * sumTemplate;
  const denominator = Math.sqrt((count * sumScreen2 - sumScreen ** 2) * (count * sumTemplate2 - sumTemplate ** 2));
  return denominator > 0 ? numerator / denominator : -1;
}

async function visualCatalogTemplates() {
  if (visualCatalogPromise) return visualCatalogPromise;
  visualCatalogPromise = (async () => {
    const catalog = await localJson("/api/lcu/visual-catalog");
    const entities = Array.isArray(catalog.entities) ? catalog.entities : [];
    const templates = [];
    const cacheDirectory = path.join(app.getPath("userData"), "visual-icons");
    fs.mkdirSync(cacheDirectory, { recursive: true });
    let cursor = 0;
    const worker = async () => {
      while (cursor < entities.length) {
        const entity = entities[cursor++];
        try {
          const cachePath = path.join(cacheDirectory, `${String(entity.entityKey).replaceAll(/[^a-z0-9_-]+/gi, "_")}.png`);
          let bytes;
          if (fs.existsSync(cachePath)) bytes = fs.readFileSync(cachePath);
          else {
            const response = await fetch(entity.iconUrl, { headers: { "User-Agent": "ArenaBuildLab/1.0" } });
            if (!response.ok) continue;
            bytes = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(cachePath, bytes);
          }
          const image = nativeImage.createFromBuffer(bytes);
          if (image.isEmpty()) continue;
          const templateSize = entity.kind === "item" ? 96 : 128;
          templates.push({ entityKey: entity.entityKey, kind: entity.kind, name: entity.name, bitmap: image.resize({ width: templateSize, height: templateSize, quality: "best" }).toBitmap() });
        } catch { /* One missing icon must not disable the visual catalog. */ }
      }
    };
    await Promise.all(Array.from({ length: 10 }, () => worker()));
    return templates;
  })().catch((error) => { visualCatalogPromise = undefined; throw error; });
  return visualCatalogPromise;
}

async function matchVisualOffers(thumbnail) {
  const templates = await visualCatalogTemplates();
  if (templates.length === 0) return { match: null, diagnostics: { reason: "empty-catalog" } };
  const { width, height } = thumbnail.getSize();
  const matchKind = (kind, cropVariants, templateSize, minimumScore, minimumMargin) => {
    const kindTemplates = templates.filter((template) => template.kind === kind);
    const results = [];
    for (const centerXRatio of [0.2945, 0.5, 0.705]) {
      const bestByEntity = new Map();
      for (const variant of cropVariants) {
        const cropSize = Math.max(templateSize, Math.round(width * variant.size));
        const centerY = Math.round(height * variant.y);
        const crop = thumbnail.crop({
          x: Math.max(0, Math.min(width - cropSize, Math.round(width * centerXRatio - cropSize / 2))),
          y: Math.max(0, Math.min(height - cropSize, Math.round(centerY - cropSize / 2))),
          width: Math.min(cropSize, width),
          height: Math.min(cropSize, height),
        }).resize({ width: templateSize, height: templateSize, quality: "best" }).toBitmap();
        for (const template of kindTemplates) {
          const score = maskedCorrelation(crop, template.bitmap, kind === "item" ? 0 : 12);
          const previous = bestByEntity.get(template.entityKey);
          if (!previous || score > previous.score) bestByEntity.set(template.entityKey, { ...template, score, variant });
        }
      }
      const ranked = [...bestByEntity.values()].sort((left, right) => right.score - left.score);
      const deduped = [];
      for (const candidate of ranked) if (!deduped.some((seen) => seen.name === candidate.name)) deduped.push(candidate);
      const best = deduped[0];
      const runnerUp = deduped[1];
      results.push({ entityKey: best?.entityKey ?? "", name: best?.name ?? "", score: best?.score ?? -1, margin: best ? best.score - (runnerUp?.score ?? -1) : -1, variant: best?.variant ?? null });
    }
    const accepted = results.length === 3 && results.every((result) => result.entityKey && result.score >= minimumScore && result.margin >= minimumMargin);
    return { kind, matches: results, confidence: Math.min(...results.map((result) => result.score)), accepted };
  };
  const augment = matchKind("augment", [{ y: 0.2935, size: 0.0933 }], 128, 0.82, 0.03);
  // Prismatic art is smaller than augment art and shifts vertically across
  // Arena/Mayhem UI scales. Search bounded icon-sized crops inside each card.
  const item = matchKind("item", [
    { y: 0.24, size: 0.036 }, { y: 0.24, size: 0.046 }, { y: 0.24, size: 0.058 },
    { y: 0.27, size: 0.036 }, { y: 0.27, size: 0.046 }, { y: 0.27, size: 0.058 },
    { y: 0.294, size: 0.036 }, { y: 0.294, size: 0.046 }, { y: 0.294, size: 0.058 },
    { y: 0.32, size: 0.036 }, { y: 0.32, size: 0.046 }, { y: 0.32, size: 0.058 },
    { y: 0.35, size: 0.036 }, { y: 0.35, size: 0.046 }, { y: 0.35, size: 0.058 },
  ], 96, 0.58, 0.025);
  const accepted = [augment, item].filter((candidate) => candidate.accepted).sort((left, right) => right.confidence - left.confidence);
  const provisional = accepted.length === 0 && item.matches.every((match) => match.entityKey && match.score >= 0.5 && match.margin >= 0.02) && !augment.matches.every((match) => match.entityKey && match.score >= 0.82 && match.margin >= 0.03)
    ? [{ kind: "item", matches: item.matches, confidence: item.confidence, accepted: false, provisional: true }]
    : [];
  return {
    match: accepted[0] ?? provisional[0] ?? null,
    diagnostics: {
      augment: { accepted: augment.accepted, confidence: augment.confidence, cards: augment.matches.map(({ name, score, margin }) => ({ name, score, margin })) },
      item: { accepted: item.accepted, confidence: item.confidence, cards: item.matches.map(({ name, score, margin, variant }) => ({ name, score, margin, variant })) },
    },
  };
}

function appendVisualDiagnostic(payload) {
  try {
    const target = path.join(app.getPath("userData"), "selection-diagnostics.local.ndjson");
    fs.appendFileSync(target, `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`, "utf8");
  } catch { /* Diagnostics must never interrupt the selection pipeline. */ }
}

function maybeConfirmVisualPick() {
  if (!visualSession?.closed || !Array.isArray(visualSession.offered) || visualSession.offered.length !== 3 || visualSession.hoverStreak < 2 || visualSession.lastHover < 0) return;
  const entityKey = visualSession.offered[visualSession.lastHover];
  const kind = visualSession.kind;
  resetVisualSession();
  if (kind === "item") void localJson("/api/lcu/visual-event", "POST", { kind, picked: entityKey }).catch(() => {});
  else void localJson("/api/lcu/selection", "POST", { entityKey }).catch(() => {});
}

async function scanVisualOffers(thumbnail, snapshot, session) {
  visualScanInFlight = true;
  session.lastScanAt = Date.now();
  try {
    const localResult = await matchVisualOffers(thumbnail);
    const localMatches = localResult.match;
    appendVisualDiagnostic({ event: "offer-scan", diagnostics: localResult.diagnostics });
    let result;
    if (localMatches?.matches.length === 3) {
      const offered = localMatches.matches.map((match) => match.entityKey);
      await localJson("/api/lcu/visual-event", "POST", { kind: localMatches.kind, offered });
      result = { offered, kind: localMatches.kind };
    } else if (!settings.openAiApiKey) {
      result = null;
    } else {
      const size = thumbnail.getSize();
      const width = Math.min(1600, size.width);
      const image = width < size.width ? thumbnail.resize({ width, quality: "best" }) : thumbnail;
      const screenshotDataUrl = `data:image/jpeg;base64,${image.toJPEG(72).toString("base64")}`;
      result = await localJson("/api/lcu/visual-scan", "POST", { screenshotDataUrl, sequence: snapshot.sequence });
      result.kind = "augment";
    }
    if (visualSession === session && result) {
      session.offered = result.offered;
      session.kind = result.kind;
      maybeConfirmVisualPick();
    }
  } catch {
    if (visualSession === session && session.closed) resetVisualSession();
  } finally { visualScanInFlight = false; }
}

async function pollVisualAugmentSelection() {
  if (visualPollBusy) return;
  visualPollBusy = true;
  try {
    const snapshot = await localJson("/api/lcu/status?once=1");
    if (!snapshot.supportsAugments || !["in_progress", "augment_select"].includes(snapshot.phase)) {
      resetVisualSession();
      return;
    }
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: display.size });
    const source = sources.find((candidate) => String(candidate.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) return;
    const thumbnail = source.thumbnail;
    const size = thumbnail.getSize();
    const detected = detectAugmentSelectionFrame(thumbnail.toBitmap(), size.width, size.height);
    if (detected) {
      visualMissingFrames = 0;
      visualDetectedFrames += 1;
      if (!visualSession) visualSession = { offered: null, lastHover: -1, hoverStreak: 0, closed: false, startedAt: Date.now(), lastScanAt: 0 };
      const hover = cardIndexAtPoint(cursorPoint, display.bounds);
      if (hover >= 0 && hover === visualSession.lastHover) visualSession.hoverStreak += 1;
      else { visualSession.lastHover = hover; visualSession.hoverStreak = hover >= 0 ? 1 : 0; }
      if (visualDetectedFrames >= 2 && !visualSession.offered && !visualScanInFlight && Date.now() - visualSession.lastScanAt > 3_000) {
        void scanVisualOffers(thumbnail, snapshot, visualSession);
      }
      return;
    }
    visualDetectedFrames = 0;
    if (!visualSession) return;
    visualMissingFrames += 1;
    if (visualMissingFrames >= 2) {
      visualSession.closed = true;
      maybeConfirmVisualPick();
      if (!visualScanInFlight && visualSession) resetVisualSession();
    }
  } catch {
    // League and the local server are expected to disappear between sessions.
  } finally { visualPollBusy = false; }
}

function startVisualAugmentWatcher() {
  clearInterval(visualWatcherTimer);
  visualWatcherTimer = setInterval(() => void pollVisualAugmentSelection(), 750);
}

function startOverwolfAugmentProvider() {
  const gep = app.overwolf?.packages?.gep;
  if (!gep) return false;
  gep.on("game-detected", (event) => event.enable());
  gep.setRequiredFeatures(["augments", "live_client_data", "match_info"]);
  gep.on("new-info-update", (_event, _gameId, ...updates) => forwardProviderEvent(updates));
  gep.on("new-game-event", (_event, _gameId, ...events) => forwardProviderEvent(events));
  return true;
}

async function capturePicker() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: display.size });
  const source = sources.find((candidate) => String(candidate.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return;
  clipboard.writeImage(source.thumbnail);
  mainWindow.show();
  mainWindow.focus();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const clicked = await mainWindow.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => /Paste (?:augment|Mayhem card) snip/i.test(candidate.textContent || "")); if (!button) return false; button.click(); return true; })()`);
    if (clicked) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function createWindow() {
  const initialBounds = visibleOverlayBounds(readSettings().overlayBounds);
  mainWindow = new BrowserWindow({
    ...initialBounds, minWidth: 225, minHeight: 300,
    frame: false, transparent: OBS_MODE, alwaysOnTop: !OBS_MODE, resizable: false,
    backgroundColor: OBS_MODE ? "#00FF00" : "#100d17",
    icon: appIconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.cjs") },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("move", persistOverlayBoundsSoon);
  mainWindow.on("resize", persistOverlayBoundsSoon);
  mainWindow.on("close", (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/overlay${OBS_MODE ? "?obs=1" : dataInitializing ? "?welcome=1" : ""}`);
  mainWindow.webContents.on("did-finish-load", () => {
    const css = OBS_MODE
      ? `html,body,.overlay-page{background:#00FF00!important}.overlay-topline,footer{display:none!important}.live-overlay{background:transparent!important;box-shadow:none!important}body{-webkit-app-region:drag}button,a,input,select,textarea{ -webkit-app-region:no-drag }`
      : `body{-webkit-app-region:drag}button,a,input,select,textarea{ -webkit-app-region:no-drag }`;
    mainWindow.webContents.insertCSS(css);
    applyAppearance(appearance, false);
  });
}

function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    resizable: true,
    backgroundColor: "#090d14",
    icon: appIconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.cjs") },
  });
  dashboardWindow.setMenuBarVisibility(false);
  dashboardWindow.on("close", (event) => {
    if (!app.isQuitting) { event.preventDefault(); dashboardWindow.hide(); }
  });
  dashboardWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  dashboardWindow.once("ready-to-show", () => dashboardWindow?.show());
}

function openDashboard(route = "/") {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  dashboardWindow.loadURL(`http://127.0.0.1:${PORT}${route}`);
  if (dashboardWindow.isMinimized()) dashboardWindow.restore();
  dashboardWindow.show();
  dashboardWindow.focus();
}

function openSettings() {
  openDashboard("/settings");
}

function openOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  windowMode = "overlay";
  mainWindow.setResizable(false);
  setWindowBounds({ ...mainWindow.getBounds(), width: Math.round(OVERLAY_BASE_WIDTH * appearance.scale), height: Math.round(OVERLAY_BASE_HEIGHT * appearance.scale) });
  persistOverlayBoundsSoon();
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/overlay${OBS_MODE ? "?obs=1" : ""}`);
  mainWindow.show();
}

function createTray() {
  const icon = nativeImage.createFromPath(appIconPath());
  if (icon.isEmpty()) throw new Error(`Tray icon is missing or invalid: ${appIconPath()}`);
  tray = new Tray(icon.resize({ width: 20, height: 20, quality: "best" }));
  tray.setToolTip("Arena Build Lab");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => openDashboard() },
    { label: "Show Overlay", click: openOverlay },
    { label: "Open Settings", click: openSettings },
    { label: "Reset Overlay Position", click: resetOverlayPosition },
    { label: "Launch at startup", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: "OBS chroma mode", type: "checkbox", checked: OBS_MODE, enabled: false },
    { type: "separator" },
    { label: "Quit Arena Build Lab", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => openDashboard());
}

async function pollDesktopNotifications() {
  if (!Notification.isSupported()) return;
  const settings = readSettings();
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/notifications`, { signal: AbortSignal.timeout(4_000) });
    if (response.ok) {
      const payload = await response.json();
      const pending = Array.isArray(payload.notifications) ? payload.notifications : [];
      const enabled = pending.filter((entry) => entry.kind === "pro_match" ? settings.notifyProMatches : entry.kind === "personal_record" ? settings.notifyRecords : true);
      for (const entry of enabled) new Notification({ title: String(entry.title), body: String(entry.body), icon: appIconPath() }).show();
      if (pending.length) await fetch(`http://127.0.0.1:${PORT}/api/notifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: pending.map((entry) => entry.id) }), signal: AbortSignal.timeout(4_000) });
    }
    if (settings.notifyPatch) {
      const patchResponse = await fetch(`http://127.0.0.1:${PORT}/api/patch-status`, { signal: AbortSignal.timeout(6_000) });
      if (patchResponse.ok) {
        const patch = await patchResponse.json();
        if (patch.stale && patch.livePatch && patchNotifiedVersion !== patch.livePatch) {
          patchNotifiedVersion = patch.livePatch;
          new Notification({ title: `League patch ${patch.liveDisplayPatch || patch.livePatch} available`, body: "Open Settings to sync the latest local game data.", icon: appIconPath() }).show();
        }
      }
    }
  } catch { /* The local service may be restarting; the next interval retries. */ }
}

function startDesktopNotifications() {
  clearInterval(notificationTimer);
  void pollDesktopNotifications();
  notificationTimer = setInterval(() => void pollDesktopNotifications(), 30_000);
}

function syncTrackedPlayersInBackground() {
  const settings = readSettings();
  if (trackedPlayerSyncBusy || !settings.notifyProMatches || !settings.riotApiKey) return;
  trackedPlayerSyncBusy = true;
  try {
    const worker = spawnWorker("pros");
    const done = () => { trackedPlayerSyncBusy = false; void pollDesktopNotifications(); };
    worker.child.once("error", done);
    worker.child.once(worker.exitEvent, done);
  } catch { trackedPlayerSyncBusy = false; }
}

function startTrackedPlayerSchedule() {
  clearInterval(trackedPlayerTimer);
  trackedPlayerTimer = setInterval(syncTrackedPlayersInBackground, 60 * 60 * 1_000);
}

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:save", async (_event, next) => {
  try {
    const value = writeSettings(next || {});
    app.setLoginItemSettings({ openAtLogin: value.openAtLogin });
    await restartNext();
    return { ok: true, restarted: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle("appearance:apply", (_event, next) => applyAppearance(next || appearance));
ipcMain.handle("window:overlay", () => { openOverlay(); return { ok: true }; });
ipcMain.handle("worker:run", (_event, worker) => {
  const selected = worker === "youtube" ? "youtube" : worker === "data" ? "data" : worker === "pros" ? "pros" : "riot";
  const label = selected === "youtube" ? "YouTube catalog" : selected === "data" ? "Data Dragon" : selected === "pros" ? "Tracked player" : "Riot match";
  try {
    const workerProcess = spawnWorker(selected);
    return new Promise((resolve) => {
      workerProcess.child.once("error", (error) => resolve({ ok: false, message: `${label} sync could not start: ${error.message}` }));
      workerProcess.child.once(workerProcess.exitEvent, (code) => resolve(code === 0
        ? { ok: true, message: `${label} sync completed.` }
        : { ok: false, message: `${label} sync exited with code ${code ?? "unknown"}.` }));
    });
  } catch (error) {
    return { ok: false, message: `${label} worker is unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
});

if (!hasSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  openDashboard();
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const saved = readSettings();
  appearance = { opacity: saved.opacity, scale: saved.scale };
  initializeDataIfNeeded();
  seedVideoCatalogIfNeeded();
  startNext();
  await waitForServer();
  createWindow();
  createDashboardWindow();
  createTray();
  startOverwolfAugmentProvider();
  void visualCatalogTemplates().catch(() => {});
  startVisualAugmentWatcher();
  startDesktopNotifications();
  startTrackedPlayerSchedule();
  globalShortcut.register("CommandOrControl+Shift+A", () => void capturePicker());
  app.setLoginItemSettings({ openAtLogin: saved.openAtLogin });
});

app.on("window-all-closed", () => {});
app.on("will-quit", () => {
  if (windowMode === "overlay" && mainWindow && !mainWindow.isDestroyed()) writeSettings({ overlayBounds: mainWindow.getBounds() });
  clearTimeout(boundsSaveTimer);
  clearInterval(visualWatcherTimer);
  clearInterval(notificationTimer);
  clearInterval(trackedPlayerTimer);
  globalShortcut.unregisterAll();
  if (serverProcess) serverProcess.kill();
});
