import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { detectAugmentSelectionFrame, cardIndexAtPoint } = require("../electron/visual-selection-detector.cjs") as {
  detectAugmentSelectionFrame: (bitmap: Buffer, width: number, height: number) => boolean;
  cardIndexAtPoint: (point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }) => number;
};

function syntheticSelectionFrame(width = 1600, height = 900): Buffer {
  const bitmap = Buffer.alloc(width * height * 4, 105);
  const pixel = (x: number, y: number, value: number) => {
    const offset = (y * width + x) * 4;
    bitmap[offset] = value;
    bitmap[offset + 1] = value;
    bitmap[offset + 2] = value;
    bitmap[offset + 3] = 255;
  };
  for (const center of [0.29, 0.51, 0.705]) {
    for (let y = Math.round(height * 0.18); y < height * 0.68; y += 1) {
      for (let x = Math.round(width * (center - 0.045)); x < width * (center + 0.045); x += 1) pixel(x, y, 18);
    }
  }
  for (const border of [0.208, 0.381, 0.413, 0.586, 0.617, 0.792]) {
    for (let y = Math.round(height * 0.18); y < height * 0.68; y += 1) {
      for (let x = Math.round(width * border) - 5; x <= Math.round(width * border) + 5; x += 1) pixel(x, y, 220);
    }
  }
  return bitmap;
}

test("detects the normalized three-card selection layout", () => {
  assert.equal(detectAugmentSelectionFrame(syntheticSelectionFrame(), 1600, 900), true);
  assert.equal(detectAugmentSelectionFrame(syntheticSelectionFrame(2304, 1440), 2304, 1440), true);
  assert.equal(detectAugmentSelectionFrame(Buffer.alloc(1600 * 900 * 4, 105), 1600, 900), false);
});

test("maps cursor positions to the three visible cards", () => {
  const bounds = { x: 0, y: 0, width: 1600, height: 900 };
  assert.equal(cardIndexAtPoint({ x: 450, y: 400 }, bounds), 0);
  assert.equal(cardIndexAtPoint({ x: 800, y: 400 }, bounds), 1);
  assert.equal(cardIndexAtPoint({ x: 1140, y: 400 }, bounds), 2);
  assert.equal(cardIndexAtPoint({ x: 50, y: 400 }, bounds), -1);
});
