export type MechanicsAnalysis = {
  tags: string[];
  produces: string[];
  consumes: string[];
};

type StatDefinition = {
  key: string;
  label: string;
  pattern: string;
};

export const STAT_DEFINITIONS: StatDefinition[] = [
  { key: "health", label: "Health", pattern: "(?:max |bonus )?health|hp" },
  { key: "mana", label: "Mana", pattern: "(?:max |bonus )?mana" },
  { key: "attack_damage", label: "Attack Damage", pattern: "attack damage|bonus ad|adaptive force" },
  { key: "ability_power", label: "Ability Power", pattern: "ability power|\\bap\\b|adaptive force" },
  { key: "attack_speed", label: "Attack Speed", pattern: "attack speed|attacks per second" },
  { key: "ability_haste", label: "Ability Haste", pattern: "ability haste|cooldown" },
  { key: "movement_speed", label: "Move Speed", pattern: "move(?:ment)? speed" },
  { key: "crit_chance", label: "Critical Strike", pattern: "critical strike chance|crit chance" },
  { key: "crit_damage", label: "Critical Damage", pattern: "critical strike damage|crit damage" },
  { key: "armor", label: "Armor", pattern: "\\barmor\\b" },
  { key: "magic_resist", label: "Magic Resist", pattern: "magic resist(?:ance)?|\\bmr\\b" },
  { key: "heal_shield", label: "Healing & Shielding", pattern: "heal(?:ing)?|shield(?:ing)?|health regen" },
  { key: "lifesteal", label: "Lifesteal", pattern: "lifesteal|life steal" },
  { key: "omnivamp", label: "Omnivamp", pattern: "omnivamp" },
  { key: "penetration", label: "Penetration", pattern: "penetration|lethality" },
  { key: "range", label: "Range", pattern: "attack range|cast range" },
  { key: "gold", label: "Gold", pattern: "\\bgold\\b|coins" },
  { key: "size", label: "Size", pattern: "\\bsize\\b|larger|tiny" },
  { key: "cursed_power", label: "Cursed Power", pattern: "cursed power" },
];

const THEME_DEFINITIONS: Array<[string, RegExp]> = [
  ["conversion", /convert|conversion|equal to|based on|per (?:point|1%|stack)/i],
  ["stacking", /permanent|stack|each round|per takedown|infinitely/i],
  ["on_hit", /on-hit|your attacks|basic attacks/i],
  ["autocast", /autocast|automatically cast/i],
  ["burn", /\bburn\b|damage over time|\bdot\b/i],
  ["curse", /cursed power|\bcurse\b/i],
  ["stat_anvil", /stat anvil|stat shard|shardholder|shardblade/i],
  ["quest", /\bquest\b|requirement:|reward:/i],
  ["execute", /execute|below .*health/i],
  ["damage_amp", /increased damage|damage amp|more damage/i],
  ["healing_engine", /heal|shield|health regen/i],
  ["defense", /armor|magic resist|damage reduction|shield/i],
  ["mobility", /move(?:ment)? speed|dash|blink|teleport/i],
  ["critical", /critical strike|\bcrit\b/i],
];

export function stripMarkup(input: string): string {
  return input
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/@[A-Za-z0-9_.*+-]+@/g, "{value}")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function hasNearby(text: string, statPattern: string, lead: string, trail = ""): boolean {
  return new RegExp(`(?:${lead})[^.]{0,95}(?:${statPattern})${trail}`, "i").test(text);
}

export function analyzeMechanics(...parts: string[]): MechanicsAnalysis {
  const text = stripMarkup(parts.filter(Boolean).join(" "));
  const tags = new Set<string>();
  const produces = new Set<string>();
  const consumes = new Set<string>();

  for (const stat of STAT_DEFINITIONS) {
    const mention = new RegExp(stat.pattern, "i");
    if (!mention.test(text)) continue;
    tags.add(stat.key);

    if (
      hasNearby(text, stat.pattern, "gain|grant|increase|restore|add|receive|deal|convert[^.]{0,50}(?:to|into)") ||
      new RegExp(`(?:${stat.pattern})[^.]{0,70}(?:increased|bonus|on-hit|damage)`, "i").test(text)
    ) {
      produces.add(stat.key);
    }

    if (
      hasNearby(text, stat.pattern, "based on|equal to|scales? with|for every|per|from|of your|convert") ||
      new RegExp(`(?:${stat.pattern})[^.]{0,60}(?:to|into|above|spent|lost)`, "i").test(text)
    ) {
      consumes.add(stat.key);
    }
  }

  for (const [tag, pattern] of THEME_DEFINITIONS) {
    if (pattern.test(text)) tags.add(tag);
  }

  return {
    tags: [...tags].sort(),
    produces: [...produces].sort(),
    consumes: [...consumes].sort(),
  };
}

export function labelForTag(tag: string): string {
  return STAT_DEFINITIONS.find((definition) => definition.key === tag)?.label ??
    tag.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
