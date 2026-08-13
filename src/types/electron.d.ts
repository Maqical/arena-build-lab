export {};

declare global {
  interface Window {
    arenaDesktop?: {
      isDesktop: boolean;
      getSettings: () => Promise<{ riotApiKey: string; openAiApiKey: string; opacity: number; scale: number; openAtLogin: boolean }>;
      saveSettings: (settings: { riotApiKey?: string; openAiApiKey?: string; opacity?: number; scale?: number; openAtLogin?: boolean }) => Promise<{ ok: boolean; restarted?: boolean; error?: string }>;
      runWorker: (worker: "riot" | "youtube") => Promise<{ ok: boolean; message: string }>;
      applyAppearance: (appearance: { opacity: number; scale: number }) => Promise<{ ok: boolean }>;
      openOverlay: () => Promise<{ ok: boolean }>;
      checkForUpdates: () => Promise<{ ok: boolean; message: string }>;
    };
  }
}
