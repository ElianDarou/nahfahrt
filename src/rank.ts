/** Local station search: normalization, matching and usage ranking. */

export interface Rankable {
  name: string;
  sub?: string;
  label?: string;
  count: number;
  last: number;
  fav?: boolean;
}

export function normalize(text: string): string {
  return text
    .toLocaleLowerCase("de")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bhauptbahnhof\b/g, "hbf")
    .replace(/\bbahnhof\b/g, "bf")
    .trim();
}

/** Every typed word must start a word of the station, or occur within it from 3 letters on. */
export function matches(query: string, station: Rankable): boolean {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalize(`${station.label ?? ""} ${station.name} ${station.sub ?? ""}`);
  const words = haystack.split(" ");
  return terms.every(
    (term) =>
      words.some((word) => word.startsWith(term)) || (term.length >= 3 && haystack.includes(term)),
  );
}

const HALF_LIFE_DAYS = 45;

/** Frequent use counts most; old habits slowly lose weight. */
export function usageScore(station: Pick<Rankable, "count" | "last">, now = Date.now()): number {
  const ageDays = Math.max(0, now - station.last) / 86_400_000;
  return station.count * 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

export function byUsage<T extends Rankable>(stations: T[], now = Date.now()): T[] {
  return [...stations].sort(
    (left, right) =>
      Number(!!right.fav) - Number(!!left.fav) ||
      usageScore(right, now) - usageScore(left, now) ||
      right.last - left.last,
  );
}
