const BORDER_X = [0.208, 0.381, 0.413, 0.586, 0.617, 0.792];
const INNER_X = [0.29, 0.51, 0.705];

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))];
}

function luminance(buffer, width, x, y) {
  const offset = (y * width + x) * 4;
  return (Number(buffer[offset]) + Number(buffer[offset + 1]) + Number(buffer[offset + 2])) / 3;
}

function stripePercentile(buffer, width, height, normalizedX, halfWidth, fraction) {
  const centerX = Math.round(normalizedX * width);
  const y0 = Math.round(0.18 * height);
  const y1 = Math.round(0.68 * height);
  const values = [];
  for (let y = y0; y < y1; y += 3) {
    for (let x = Math.max(0, centerX - halfWidth); x <= Math.min(width - 1, centerX + halfWidth); x += 2) {
      values.push(luminance(buffer, width, x, y));
    }
  }
  return percentile(values, fraction);
}

/** Detects the stable three-card layout observed at normalized 16:9 and 16:10 Arena coordinates. */
function detectAugmentSelectionFrame(bitmap, width, height) {
  if (!Buffer.isBuffer(bitmap) || width < 960 || height < 540 || bitmap.length < width * height * 4) return false;
  const aspect = width / height;
  if (aspect < 1.55 || aspect > 1.9) return false;
  const borderThresholds = BORDER_X.map((x) => stripePercentile(bitmap, width, height, x, 4, 0.75));
  const innerThresholds = INNER_X.map((x) => stripePercentile(bitmap, width, height, x, Math.max(12, Math.round(width * 0.011)), 0.35));
  const brightBorders = borderThresholds.filter((value) => value > 145).length;
  const darkInteriors = innerThresholds.filter((value) => value < 60).length;
  return brightBorders >= 5 && darkInteriors === 3;
}

function cardIndexAtPoint(point, displayBounds) {
  if (!point || !displayBounds?.width || !displayBounds?.height) return -1;
  const x = (point.x - displayBounds.x) / displayBounds.width;
  const y = (point.y - displayBounds.y) / displayBounds.height;
  if (y < 0.15 || y > 0.76) return -1;
  if (x >= 0.19 && x <= 0.39) return 0;
  if (x >= 0.4 && x <= 0.6) return 1;
  if (x >= 0.61 && x <= 0.81) return 2;
  return -1;
}

module.exports = { detectAugmentSelectionFrame, cardIndexAtPoint };
