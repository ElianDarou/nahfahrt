import type { Place } from "./places";

/**
 * Stop names change slowly, so a month is a safe lifetime. Addresses never go in: they are
 * personal, and a search with a house number goes upstream every time.
 */
export const CACHE_DAYS = 30;

export const normalizeQuery = (text: string): string =>
  text
    .trim()
    .toLocaleLowerCase("de")
    .replace(/\s+/g, " ");

/**
 * What a cached answer is filed under: the text and the coarse region it was biased to.
 * The app rounds the region to two decimals, about a kilometre.
 */
export const cacheKey = (text: string, near?: string): string =>
  near ? `${normalizeQuery(text)}|${near}` : normalizeQuery(text);

/** Only pure stop lists are kept; a result with an address in it is not cached at all. */
export const cacheable = (places: Place[]): boolean =>
  places.length > 0 && places.every((place) => place.a !== 1);
