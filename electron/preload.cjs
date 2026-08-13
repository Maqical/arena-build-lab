/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arenaDesktop", {
  isDesktop: true,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  runWorker: (worker) => ipcRenderer.invoke("worker:run", worker),
  applyAppearance: (appearance) => ipcRenderer.invoke("appearance:apply", appearance),
  openOverlay: () => ipcRenderer.invoke("window:overlay"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
});
