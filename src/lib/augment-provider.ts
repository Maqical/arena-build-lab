export type AugmentProviderUpdate = { offered: string[]; picked: string | null };

function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try { return JSON.parse(trimmed) as unknown; } catch { return value; }
}

function record(value: unknown): Record<string, unknown> | null {
  const parsed = decoded(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

/** Normalizes Overwolf GEP's documented augments/picked_augment info updates. */
export function parseAugmentProviderUpdate(payload: unknown): AugmentProviderUpdate {
  const offered: string[] = [];
  let picked: string | null = null;
  const visit = (value: unknown, keyPath: string, depth: number) => {
    if (depth > 9 || value == null) return;
    const parsed = decoded(value);
    if (Array.isArray(parsed)) {
      parsed.forEach((entry, index) => visit(entry, `${keyPath}.${index}`, depth + 1));
      return;
    }
    const object = record(parsed);
    if (!object) return;
    const key = String(object.key ?? "");
    const category = String(object.category ?? "");
    const nestedValue = decoded(object.value ?? object.data);
    if (key === "picked_augment" && typeof nestedValue === "string" && nestedValue.trim()) picked = nestedValue.trim();
    if (key === "augments" || category === "augments" || /(?:^|\.)augments$/i.test(keyPath)) {
      const augmentObject = record(nestedValue) ?? (key === "augments" ? object : null);
      if (augmentObject) {
        for (const [entryKey, entry] of Object.entries(augmentObject)) {
          if (!/^augment_\d+$/i.test(entryKey)) continue;
          const name = String(record(entry)?.name ?? "").trim();
          if (name) offered.push(name);
        }
      }
    }
    for (const [childKey, child] of Object.entries(object)) visit(child, `${keyPath}.${childKey}`, depth + 1);
  };
  visit(payload, "provider", 0);
  return { offered: [...new Set(offered)].slice(0, 3), picked };
}
