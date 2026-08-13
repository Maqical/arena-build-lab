import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizedBounds, visibleOverlayBounds } = require("../electron/window-state.cjs") as {
  normalizedBounds: (value: unknown) => { x: number; y: number; width: number; height: number } | null;
  visibleOverlayBounds: (saved: unknown, displays: Array<{ workArea: { x: number; y: number; width: number; height: number } }>, scale?: number) => { x: number; y: number; width: number; height: number };
};

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }];

test("restores exact overlay bounds when they remain visible", () => {
  const saved = { x: 2200, y: 180, width: 500, height: 800 };
  assert.deepEqual(visibleOverlayBounds(saved, displays, 1.25), saved);
});

test("moves an off-screen overlay back onto the primary display", () => {
  assert.deepEqual(visibleOverlayBounds({ x: 9000, y: 9000, width: 450, height: 720 }, displays), { x: 1446, y: 160, width: 450, height: 720 });
});

test("migrates the legacy 300x600 overlay while preserving its position", () => {
  assert.deepEqual(visibleOverlayBounds({ x: 100, y: 120, width: 300, height: 600 }, displays), { x: 100, y: 120, width: 450, height: 720 });
});

test("migrates the previous 420x720 overlay to the readable width", () => {
  assert.deepEqual(visibleOverlayBounds({ x: 100, y: 120, width: 420, height: 720 }, displays), { x: 100, y: 120, width: 450, height: 720 });
});

test("rejects malformed or unusably small persisted bounds", () => {
  assert.equal(normalizedBounds({ x: "nope", y: 10, width: 300, height: 600 }), null);
  assert.equal(normalizedBounds({ x: 10, y: 10, width: 100, height: 100 }), null);
});
