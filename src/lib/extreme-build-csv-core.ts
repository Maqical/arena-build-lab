export type ExtremeBuildCsvRow = {
  objective: "maxHealth" | "totalAttackDamage" | "abilityPower" | "attackSpeed" | string;
  rank: number;
  champion: string;
  level: number;
  benchmarkScore: number;
  theoreticalUnbounded: boolean;
  status: string;
  augments: string[];
  fixedItems: string[];
  stats: {
    maxHealth: number;
    totalAttackDamage: number;
    abilityPower: number;
    attackSpeed: number;
    armor: number;
    magicResistance: number;
    abilityHaste: number;
    effectiveCooldownReductionPercent: number;
  };
  scenario: Record<string, unknown>;
};

export function parseCsvRecords(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some(Boolean)) rows.push(row);
  }
  if (quoted) throw new Error("Extreme-build CSV contains an unterminated quoted field.");
  return rows;
}

function finite(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function splitBuildPart(value: string): string[] {
  return value.split(" + ").map((entry) => entry.trim()).filter(Boolean);
}

export function parseExtremeBuildCsv(contents: string): ExtremeBuildCsvRow[] {
  const [header = [], ...records] = parseCsvRecords(contents);
  const columns = new Map(header.map((name, index) => [name.trim(), index]));
  const required = ["objective", "rank", "champion", "level", "augments", "max_health", "total_ad", "ap", "attack_speed"];
  for (const name of required) if (!columns.has(name)) throw new Error(`Extreme-build CSV is missing the ${name} column.`);
  const value = (record: string[], name: string) => record[columns.get(name) ?? -1] ?? "";

  return records.map((record) => {
    let scenario: Record<string, unknown> = {};
    try { scenario = JSON.parse(value(record, "scenario") || "{}") as Record<string, unknown>; } catch { /* Preserve the row with an empty scenario. */ }
    return {
      objective: value(record, "objective"),
      rank: finite(value(record, "rank")),
      champion: value(record, "champion"),
      level: finite(value(record, "level")),
      benchmarkScore: finite(value(record, "benchmark_score")),
      theoreticalUnbounded: value(record, "theoretical_unbounded").toLowerCase() === "true",
      status: value(record, "status"),
      augments: splitBuildPart(value(record, "augments")),
      fixedItems: splitBuildPart(value(record, "fixed_items")),
      stats: {
        maxHealth: finite(value(record, "max_health")),
        totalAttackDamage: finite(value(record, "total_ad")),
        abilityPower: finite(value(record, "ap")),
        attackSpeed: finite(value(record, "attack_speed")),
        armor: finite(value(record, "armor")),
        magicResistance: finite(value(record, "mr")),
        abilityHaste: finite(value(record, "ability_haste")),
        effectiveCooldownReductionPercent: finite(value(record, "effective_cdr_percent")),
      },
      scenario,
    } satisfies ExtremeBuildCsvRow;
  });
}

