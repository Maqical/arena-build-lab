const OVERLAY_BASE_WIDTH = 450;
const OVERLAY_BASE_HEIGHT = 720;
const PREVIOUS_OVERLAY_BASE_WIDTH = 420;
const PREVIOUS_OVERLAY_BASE_HEIGHT = 720;
const LEGACY_OVERLAY_BASE_WIDTH = 300;
const LEGACY_OVERLAY_BASE_HEIGHT = 600;

function normalizedBounds(value) {
  if (!value || typeof value !== "object") return null;
  const bounds = { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) };
  return Object.values(bounds).every(Number.isFinite) && bounds.width >= 200 && bounds.height >= 300
    ? Object.fromEntries(Object.entries(bounds).map(([key, number]) => [key, Math.round(number)]))
    : null;
}

function defaultOverlayBounds(workArea, scale = 1) {
  const width = Math.round(OVERLAY_BASE_WIDTH * scale);
  const height = Math.round(OVERLAY_BASE_HEIGHT * scale);
  return { x: workArea.x + workArea.width - width - 24, y: workArea.y + Math.max(24, Math.round((workArea.height - height) / 2)), width, height };
}

function visibleOverlayBounds(saved, displays, scale = 1) {
  const primaryWorkArea = displays[0]?.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const normalized = normalizedBounds(saved);
  const shouldMigrate = normalized && (
    (normalized.width === Math.round(LEGACY_OVERLAY_BASE_WIDTH * scale) && normalized.height === Math.round(LEGACY_OVERLAY_BASE_HEIGHT * scale))
    || (normalized.width === Math.round(PREVIOUS_OVERLAY_BASE_WIDTH * scale) && normalized.height === Math.round(PREVIOUS_OVERLAY_BASE_HEIGHT * scale))
  );
  const candidate = shouldMigrate
    ? { ...normalized, width: Math.round(OVERLAY_BASE_WIDTH * scale), height: Math.round(OVERLAY_BASE_HEIGHT * scale) }
    : normalized ?? defaultOverlayBounds(primaryWorkArea, scale);
  const display = displays.find(({ workArea }) => {
    const visibleWidth = Math.max(0, Math.min(candidate.x + candidate.width, workArea.x + workArea.width) - Math.max(candidate.x, workArea.x));
    const visibleHeight = Math.max(0, Math.min(candidate.y + candidate.height, workArea.y + workArea.height) - Math.max(candidate.y, workArea.y));
    return visibleWidth >= 50 && visibleHeight >= 50;
  });
  return display ? candidate : defaultOverlayBounds(primaryWorkArea, scale);
}

module.exports = { OVERLAY_BASE_WIDTH, OVERLAY_BASE_HEIGHT, normalizedBounds, defaultOverlayBounds, visibleOverlayBounds };
