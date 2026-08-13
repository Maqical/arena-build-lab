/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, clipboard, nativeImage, screen } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const PORT = Number(process.env.ARENA_ELECTRON_PORT || 3210);
const OBS_MODE = process.argv.includes("--obs");
let serverProcess;
let mainWindow;
let tray;

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
  const env = { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", ARENA_DB_PATH: prepareUserData(), NEXT_TELEMETRY_DISABLED: "1" };
  if (app.isPackaged) {
    serverProcess = spawn(process.execPath, [rootPath("standalone", "server.js")], { cwd: rootPath("standalone"), env, stdio: "ignore" });
  } else {
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { cwd: process.cwd(), env, stdio: "ignore", shell: false });
  }
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("close", (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/overlay${OBS_MODE ? "?obs=1" : ""}`);
  mainWindow.webContents.on("did-finish-load", () => {
    const css = OBS_MODE
      ? `html,body,.overlay-page{background:#00FF00!important}.overlay-topline,footer{display:none!important}.live-overlay{background:transparent!important;box-shadow:none!important}body{-webkit-app-region:drag}button,a,input,select,textarea{ -webkit-app-region:no-drag }`
      : `body{-webkit-app-region:drag}button,a,input,select,textarea{ -webkit-app-region:no-drag }`;
    mainWindow.webContents.insertCSS(css);
  });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Arena Build Lab");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show overlay", click: () => mainWindow?.show() },
    { label: "Launch at startup", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: "OBS chroma mode", type: "checkbox", checked: OBS_MODE, enabled: false },
    { type: "separator" },
    { label: "Quit Arena Build Lab", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => mainWindow?.show());
}

app.whenReady().then(async () => {
  startNext();
  await waitForServer();
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+A", () => void capturePicker());
  app.setLoginItemSettings({ openAtLogin: app.getLoginItemSettings().openAtLogin });
});

app.on("window-all-closed", (event) => event.preventDefault());
app.on("will-quit", () => { globalShortcut.unregisterAll(); if (serverProcess) serverProcess.kill(); });
