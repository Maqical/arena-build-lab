export {};

declare global {
  interface Window {
    arenaDesktop?: {
      isDesktop: boolean;
      getSettings: () => Promise<{ riotId: string; riotApiKey: string; openAiApiKey: string; opacity: number; scale: number; openAtLogin: boolean; overlayBounds: { x: number; y: number; width: number; height: number } | null }>;
      saveSettings: (settings: { riotId?: string; riotApiKey?: string; openAiApiKey?: string; opacity?: number; scale?: number; openAtLogin?: boolean }) => Promise<{ ok: boolean; restarted?: boolean; error?: string }>;
      runWorker: (worker: "riot" | "youtube" | "data") => Promise<{ ok: boolean; message: string }>;
      applyAppearance: (appearance: { opacity: number; scale: number }) => Promise<{ ok: boolean }>;
      openOverlay: () => Promise<{ ok: boolean }>;
    };
  }
}
