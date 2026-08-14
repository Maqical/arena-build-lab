/**
 * Data Dragon keeps the engine-era major (16.x in 2026), while the public
 * patch label uses the calendar-era major (26.x). Preserve raw versions in
 * storage and use this only at presentation boundaries.
 */
export function displayPatchVersion(version: string): string {
  const match = version.trim().match(/^(\d+)\.(\d+)(?:\.\d+)?$/);
  if (!match) return version || "unknown";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `${major >= 15 && major < 25 ? major + 10 : major}.${minor}`;
}
