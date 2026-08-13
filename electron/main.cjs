/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, clipboard, nativeImage, screen, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const PORT = Number(process.env.ARENA_ELECTRON_PORT || 3210);
const OBS_MODE = process.argv.includes("--obs");
let serverProcess;
let mainWindow;
let tray;
let appearance = { opacity: 1, scale: 1 };
const settingsPath = () => path.join(app.getPath("userData"), "user_settings.json");

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { riotApiKey: String(value.riotApiKey ?? ""), openAiApiKey: String(value.openAiApiKey ?? ""), opacity: Number(value.opacity ?? 1), scale: Number(value.scale ?? 1), openAtLogin: Boolean(value.openAtLogin) };
  } catch { return { riotApiKey: process.env.RIOT_API_KEY || "", openAiApiKey: process.env.OPENAI_API_KEY || "", opacity: 1, scale: 1, openAtLogin: false }; }
}

function writeSettings(next) {
  const current = readSettings();
  const value = { ...current, ...next, opacity: Math.min(1, Math.max(0, Number(next.opacity ?? current.opacity))), scale: Math.min(1.5, Math.max(.75, Number(next.scale ?? current.scale))) };
  fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2), "utf8");
  return value;
}

function rootPath(...parts) { return path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."), ...parts); }

function prepareUserData() {
  const destination = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(destination, { recursive: true });
  const source = rootPath("data", "arena.sqlite");
  const target = path.join(destination, "arena.sqlite");
  if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
  return target;
}

function startNext() {
  const settings = readSettings();
  const env = { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", ARENA_DB_PATH: prepareUserData(), NEXT_TELEMETRY_DISABLED: "1", RIOT_API_KEY: settings.riotApiKey, OPENAI_API_KEY: settings.openAiApiKey };
  if (app.isPackaged) {
    serverProcess = spawn(process.execPath, [rootPath("standalone", "server.js")], { cwd: rootPath("standalone"), env, stdio: "ignore" });
  } else {
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { cwd: process.cwd(), env, stdio: "ignore", shell: false });
  }
}

async function restartNext() {
  if (serverProcess) serverProcess.kill();
  startNext();
  await waitForServer();
}

function applyAppearance(next) {
  appearance = { opacity: Math.min(1, Math.max(0, Number(next.opacity))), scale: Math.min(1.5, Math.max(.75, Number(next.scale))) };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(appearance.opacity);
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({ ...bounds, width: Math.round(300 * appearance.scale), height: Math.round(600 * appearance.scale) });
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
  mainWindow = new BrowserWindow({
    width: 300, height: 600, minWidth: 300, maxWidth: 300, minHeight: 400,
    frame: false, transparent: OBS_MODE, alwaysOnTop: !OBS_MODE, resizable: false,
    backgroundColor: OBS_MODE ? "#00FF00" : "#100d17",
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.cjs") },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("close", (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/overlay${OBS_MODE ? "?obs=1" : ""}`);
  mainWindow.webContents.on("did-finish-load", () => {
    const css = OBS_MODE
      ? `html,body,.overlay-page{background:#00FF00!important}.overlay-topline,footer{display:none!important}.live-overlay{background:transparent!important;box-shadow:none!important}body{-webkit-app-region:drag}button,a,input,select,textarea{ -webkit-app-region:no-drag }`
      : `body{-webkit-app-region:drag}button,a,input,select,textarea{ -webkit-app-region:no-drag }`;
    mainWindow.webContents.insertCSS(css);
    applyAppearance(appearance);
  });
}

function openSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setResizable(true);
  mainWindow.setBounds({ ...mainWindow.getBounds(), width: 700, height: 760 });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/settings`);
}

function openOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setResizable(false);
  mainWindow.setBounds({ ...mainWindow.getBounds(), width: Math.round(300 * appearance.scale), height: Math.round(600 * appearance.scale) });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/overlay${OBS_MODE ? "?obs=1" : ""}`);
  mainWindow.show();
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Arena Build Lab");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show overlay", click: () => mainWindow?.show() },
    { label: "Open Settings", click: openSettings },
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
  if (app.isPackaged) return { ok: false, message: "Worker sync requires the project checkout; use the packaged app's next release for bundled workers." };
  const command = worker === "youtube" ? "youtube:sync" : "riot:sync";
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", command], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, ...Object.fromEntries(Object.entries(readSettings()).filter(([key]) => key === "riotApiKey" || key === "openAiApiKey").map(([key, value]) => [key === "riotApiKey" ? "RIOT_API_KEY" : "OPENAI_API_KEY", value])) }, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { ok: true, message: `${command} started in the background.` };
});

app.whenReady().then(async () => {
  const saved = readSettings();
  appearance = { opacity: saved.opacity, scale: saved.scale };
  startNext();
  await waitForServer();
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+A", () => void capturePicker());
  app.setLoginItemSettings({ openAtLogin: saved.openAtLogin });
});

app.on("window-all-closed", (event) => event.preventDefault());
app.on("will-quit", () => { globalShortcut.unregisterAll(); if (serverProcess) serverProcess.kill(); });
