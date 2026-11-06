/**
 * Optional search filters. Query parameters are short because they travel with
 * every search on poor connections.
 */

export type SortMode = "fast" | "few";

export interface SearchFilters {
  sort?: SortMode;
  /** Most transfers allowed. */
  maxTransfers?: number;
  /** Allowed vehicle types as mode codes, such as "BSR". Absent means all. */
  modes?: string;
  /** Most minutes on foot at each end of the trip. */
  maxWalk?: number;
  /** Extra minutes reserved for every transfer. */
  extraTransfer?: number;
  /** Longest trip in minutes. */
  maxTravel?: number;
  /** Prefer walking routes without steps. */
  stepFree?: boolean;
  /** Stop id to travel through. */
  via?: string;
  /** Minutes to stay at the via stop. */
  viaStay?: number;
  /** Departure window, minutes since the epoch. */
  departFrom?: number;
  departTo?: number;
  /** Arrival window, minutes since the epoch. */
  arriveFrom?: number;
  arriveTo?: number;
}

/** Upstream modes for each app mode code. */
const UPSTREAM_MODES: Record<string, string[]> = {
  B: ["BUS"],
  T: ["TRAM"],
  U: ["SUBWAY"],
  S: ["SUBURBAN"],
  R: ["REGIONAL_RAIL", "REGIONAL_FAST_RAIL"],
  F: ["FERRY"],
};

export const upstreamModes = (codes: string): string =>
  [...codes].flatMap((code) => UPSTREAM_MODES[code] ?? []).join(",");

const STOP_ID = /^[\p{L}\p{N} _:.,@|()+/-]{1,160}$/u;
/** Windows beyond this are not a useful search and only burden the upstream service. */
const MAX_WINDOW_MINUTES = 24 * 60;

function readInt(params: URLSearchParams, name: string, min: number, max: number): number | undefined | null {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (!/^\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/** Returns null for invalid input, so that bad requests never reach the upstream service. */
export function parseFilters(params: URLSearchParams): SearchFilters | null {
  const filters: SearchFilters = {};

  const sort = params.get("sort");
  if (sort !== null) {
    if (sort !== "fast" && sort !== "few") return null;
    filters.sort = sort;
  }

  const modes = params.get("md");
  if (modes !== null) {
    if (!/^[BTUSRF]{1,6}$/.test(modes)) return null;
    filters.modes = modes;
  }

  const numbers = [
    ["mt", "maxTransfers", 0, 6],
    ["wk", "maxWalk", 1, 30],
    ["xt", "extraTransfer", 1, 30],
    ["tv", "maxTravel", 15, 1440],
    ["vs", "viaStay", 0, 240],
    ["df", "departFrom", 1, 99_999_999],
    ["dt", "departTo", 1, 99_999_999],
    ["af", "arriveFrom", 1, 99_999_999],
    ["al", "arriveTo", 1, 99_999_999],
  ] as const;
  for (const [param, field, min, max] of numbers) {
    const value = readInt(params, param, min, max);
    if (value === null) return null;
    if (value !== undefined) filters[field] = value;
  }

  if (params.get("sf") === "1") filters.stepFree = true;

  const via = params.get("via");
  if (via !== null) {
    if (!STOP_ID.test(via)) return null;
    filters.via = via;
  }

  // A window needs both ends and a sensible length.
  for (const [from, to] of [
    [filters.departFrom, filters.departTo],
    [filters.arriveFrom, filters.arriveTo],
  ]) {
    if ((from === undefined) !== (to === undefined)) return null;
    if (from !== undefined && to !== undefined) {
      if (to < from || to - from > MAX_WINDOW_MINUTES) return null;
    }
  }

  return filters;
}

export const hasWindow = (filters: SearchFilters): boolean =>
  filters.departFrom !== undefined || filters.arriveFrom !== undefined;
