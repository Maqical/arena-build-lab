/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, clipboard, nativeImage, screen, ipcMain, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { OVERLAY_BASE_WIDTH, OVERLAY_BASE_HEIGHT, normalizedBounds, defaultOverlayBounds: makeDefaultOverlayBounds, visibleOverlayBounds: restoreVisibleBounds } = require("./window-state.cjs");

app.setName("Arena Build Lab");

const PORT = Number(process.env.ARENA_ELECTRON_PORT || 3210);
const OBS_MODE = process.argv.includes("--obs");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let serverProcess;
let mainWindow;
let tray;
let appearance = { opacity: 1, scale: 1 };
let dataInitializing = false;
let windowMode = "overlay";
let applyingWindowBounds = false;
let boundsSaveTimer;
const settingsPath = () => path.join(app.getPath("userData"), "user_settings.json");

function defaultSettings() {
  return { riotApiKey: process.env.RIOT_API_KEY || "", openAiApiKey: process.env.OPENAI_API_KEY || "", opacity: 1, scale: 1, openAtLogin: false, overlayBounds: null };
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { riotApiKey: String(value.riotApiKey ?? ""), openAiApiKey: String(value.openAiApiKey ?? ""), opacity: Number(value.opacity ?? 1), scale: Number(value.scale ?? 1), openAtLogin: Boolean(value.openAtLogin), overlayBounds: normalizedBounds(value.overlayBounds) };
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
  const env = { ...process.env, RIOT_API_KEY: settings.riotApiKey, OPENAI_API_KEY: settings.openAiApiKey, ARENA_DB_PATH: path.join(app.getPath("userData"), "data", "arena.sqlite") };
  if (app.isPackaged) {
    if (worker === "youtube") return { child: spawn(packagedWorker("arena-youtube-sync.exe"), ["--database", env.ARENA_DB_PATH, "--details-limit", "20", "--transcripts"], { env, windowsHide: true, stdio: "ignore" }), exitEvent: "close" };
    const script = worker === "riot" ? packagedWorker("riot-sync.cjs") : packagedWorker("data-sync.cjs");
    return { child: utilityProcess.fork(script, [], { env, cwd: app.getPath("userData"), stdio: "ignore", serviceName: `Arena ${worker} worker` }), exitEvent: "exit" };
  }
  const command = worker === "youtube" ? "youtube:sync" : worker === "riot" ? "riot:sync" : "data:sync";
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return { child: spawn(npm, ["run", command], { cwd: path.resolve(__dirname, ".."), env, detached: true, stdio: "ignore", windowsHide: true }), exitEvent: "close" };
}

function initializeDataIfNeeded() {
  const database = prepareUserData();
  if (fs.existsSync(database) || dataInitializing) return;
  dataInitializing = true;
  const worker = spawnWorker("data");
  worker.child.on(worker.exitEvent, () => { dataInitializing = false; if (mainWindow && !mainWindow.isDestroyed()) openOverlay(); });
}

function startNext() {
  const settings = readSettings();
  const env = { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", ARENA_DB_PATH: prepareUserData(), NEXT_TELEMETRY_DISABLED: "1", RIOT_API_KEY: settings.riotApiKey, OPENAI_API_KEY: settings.openAiApiKey };
  if (app.isPackaged) {
    serverProcess = utilityProcess.fork(rootPath("standalone", "server.js"), [], { cwd: rootPath("standalone"), env, stdio: "ignore", serviceName: "Arena local server" });
  } else {
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { cwd: process.cwd(), env, stdio: "ignore", shell: false });
  }
}

async function restartNext() {
  if (serverProcess) serverProcess.kill();
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
      const request = http.get(`http://127.0.0.1:${PORT}/overlay`, (response) => { response.resume(); resolve(); });
      request.on("error", () => {
        if (Date.now() - started > 30_000) reject(new Error("Arena Build Lab server did not start."));
        else setTimeout(probe, 250);
      });
    };
    probe();
  });
}

async function capturePicker() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: display.size });
  const source = sources[0];
  if (!source || source.thumbnail.isEmpty()) return;
  clipboard.writeImage(source.thumbnail);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => /Paste augment snip/i.test(candidate.textContent || "")); if (button) button.click(); })()`);
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

function openSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  windowMode = "settings";
  mainWindow.setResizable(true);
  setWindowBounds({ ...mainWindow.getBounds(), width: 700, height: 760 });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/settings`);
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
    { label: "Show overlay", click: () => mainWindow?.show() },
    { label: "Open Settings", click: openSettings },
    { label: "Reset Overlay Position", click: resetOverlayPosition },
    { label: "Launch at startup", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: "OBS chroma mode", type: "checkbox", checked: OBS_MODE, enabled: false },
    { type: "separator" },
    { label: "Quit Arena Build Lab", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => mainWindow?.show());
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
ipcMain.handle("updates:check", () => ({ ok: false, message: "Updates are not configured for this local build yet." }));
ipcMain.handle("worker:run", (_event, worker) => {
  const selected = worker === "youtube" ? "youtube" : worker === "data" ? "data" : "riot";
  const label = selected === "youtube" ? "YouTube catalog" : selected === "data" ? "Data Dragon" : "Riot match";
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const saved = readSettings();
  appearance = { opacity: saved.opacity, scale: saved.scale };
  initializeDataIfNeeded();
  startNext();
  await waitForServer();
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+A", () => void capturePicker());
  app.setLoginItemSettings({ openAtLogin: saved.openAtLogin });
});

app.on("window-all-closed", () => {});
app.on("will-quit", () => {
  if (windowMode === "overlay" && mainWindow && !mainWindow.isDestroyed()) writeSettings({ overlayBounds: mainWindow.getBounds() });
  clearTimeout(boundsSaveTimer);
  globalShortcut.unregisterAll();
  if (serverProcess) serverProcess.kill();
});
