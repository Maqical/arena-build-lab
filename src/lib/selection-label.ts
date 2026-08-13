export type SelectionReference = string | number;

export function selectionNumericId(reference: SelectionReference): number | null {
  const value = String(reference).trim().replace(/^(?:augment|card):/i, "");
  if (!/^\d+$/.test(value)) return null;
  const numericId = Number(value);
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
}

export function normalizedSelectionKey(reference: SelectionReference): string {
  const numericId = selectionNumericId(reference);
  return numericId == null ? String(reference).trim() : `augment:${numericId}`;
}

export function uncataloguedSelectionLabel(reference: SelectionReference): string {
  const numericId = selectionNumericId(reference);
  return numericId == null
    ? `Uncatalogued selection (${String(reference).trim() || "unknown ID"})`
    : `Uncatalogued selection (ID: ${numericId})`;
}
