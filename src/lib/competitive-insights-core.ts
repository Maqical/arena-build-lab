export type PerformanceInputs = {
  placement: number;
  kdaRatio: number;
  damageRatio: number;
  mitigatedRatio: number;
  augmentQuality: number;
};

function bounded(value: number, minimum = 0, maximum = 1): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

export function performanceScore(input: PerformanceInputs): number {
  const placement = bounded((4 - input.placement) / 3);
  const kda = bounded(input.kdaRatio / 2);
  const damage = bounded(input.damageRatio / 2);
  const mitigated = bounded(input.mitigatedRatio / 2);
  const augments = bounded(input.augmentQuality);
  return Math.round((placement * 0.45 + kda * 0.2 + damage * 0.2 + mitigated * 0.1 + augments * 0.05) * 100);
}

export function performanceGrade(score: number): "S+" | "S" | "A" | "B" | "C" | "D" {
  if (score >= 95) return "S+";
  if (score >= 85) return "S";
  if (score >= 72) return "A";
  if (score >= 58) return "B";
  if (score >= 42) return "C";
  return "D";
}

export function tierForRank(index: number, total: number): "S" | "A" | "B" | "C" | "D" {
  const percentile = total > 0 ? index / total : 1;
  if (percentile < 0.1) return "S";
  if (percentile < 0.3) return "A";
  if (percentile < 0.6) return "B";
  if (percentile < 0.85) return "C";
  return "D";
}
