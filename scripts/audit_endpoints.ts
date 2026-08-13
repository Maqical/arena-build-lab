export {};

const base = process.env.ARENA_AUDIT_URL ?? "http://127.0.0.1:3000";
const checks: Array<{ path: string; method?: string; body?: unknown }> = [
  { path: "/api/lcu/status?once=1" }, { path: "/api/catalog" }, { path: "/api/combos" }, { path: "/api/videos" }, { path: "/api/extreme-builds?limit=1" },
  { path: "/api/lcu/resolve", method: "POST", body: { championId: 14, level: 18, currentEntityKeys: [] } },
  { path: "/api/lobby-analysis", method: "POST", body: { members: [] } },
  { path: "/api/post-game-analysis" }, { path: "/api/patch-status" },
];
async function main() { const catalog = await fetch(`${base}/api/catalog?kind=augment&limit=3`).then((response) => response.json()) as { entities: Array<{ entityKey: string }> }; checks.push({ path: "/api/ai-picker", method: "POST", body: { championId: 14, level: 18, currentEntityKeys: [], offeredAugmentKeys: catalog.entities.map((entity) => entity.entityKey), useAI: false } }); const report = []; for (const check of checks) { const started = performance.now(); const response = await fetch(`${base}${check.path}`, { method: check.method ?? "GET", headers: check.body ? { "Content-Type": "application/json" } : undefined, body: check.body ? JSON.stringify(check.body) : undefined }); const text = await response.text(); let json = false; try { JSON.parse(text); json = true; } catch { /* report below */ } const elapsedMs = Math.round(performance.now() - started); report.push({ ...check, status: response.status, json, elapsedMs, slow: elapsedMs > 500 }); } console.log(JSON.stringify(report, null, 2)); if (report.some((entry) => entry.status >= 400 || !entry.json)) process.exitCode = 1; }
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
