import type { Station } from "./store";

export const ALL_MODES = "BTUSRF";

export interface FilterState {
  sort: "" | "fast" | "few";
  maxTransfers: string;
  /** Selected mode codes. */
  modes: string;
  maxWalk: string;
  extraTransfer: string;
  maxTravel: string;
  stepFree: boolean;
  via?: Station;
  viaStay: string;
  /** Day of the time windows, YYYY-MM-DD. */
  date: string;
  departFrom: string;
  departTo: string;
  arriveFrom: string;
  arriveTo: string;
}

export const defaultFilters = (): FilterState => ({
  sort: "",
  maxTransfers: "",
  modes: ALL_MODES,
  maxWalk: "",
  extraTransfer: "",
  maxTravel: "",
  stepFree: false,
  viaStay: "0",
  date: "",
  departFrom: "",
  departTo: "",
  arriveFrom: "",
  arriveTo: "",
});

const hasDepartWindow = (filters: FilterState) => !!filters.departFrom && !!filters.departTo;
const hasArriveWindow = (filters: FilterState) => !!filters.arriveFrom && !!filters.arriveTo;
export const hasTimeWindow = (filters: FilterState) =>
  hasDepartWindow(filters) || hasArriveWindow(filters);

/** Number of filters that differ from the default, for the collapsed panel. */
export function activeFilterCount(filters: FilterState): number {
  return [
    !!filters.sort,
    filters.maxTransfers !== "",
    filters.modes !== ALL_MODES,
    filters.maxWalk !== "",
    filters.extraTransfer !== "",
    filters.maxTravel !== "",
    filters.stepFree,
    !!filters.via,
    hasDepartWindow(filters),
    hasArriveWindow(filters),
  ].filter(Boolean).length;
}

/** Why a search cannot run with these filters, in words for the user. */
export function filterProblem(filters: FilterState): string | undefined {
  if (!filters.modes) return "Wähle mindestens ein Verkehrsmittel.";
  if (!!filters.departFrom !== !!filters.departTo) return "Gib für die Abfahrt beide Uhrzeiten an.";
  if (!!filters.arriveFrom !== !!filters.arriveTo) return "Gib für die Ankunft beide Uhrzeiten an.";
  return undefined;
}

const DAY_MINUTES = 24 * 60;

function windowMinutes(date: string, from: string, to: string): [number, number] {
  const start = Math.round(new Date(`${date}T${from}`).getTime() / 60000);
  let end = Math.round(new Date(`${date}T${to}`).getTime() / 60000);
  // "22:00 bis 01:00" means the following night.
  if (end < start) end += DAY_MINUTES;
  return [start, end];
}

/** Today in the format of a date input. */
export function todayInput(now = new Date()): string {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Query parameters of the journey endpoint. */
export function filtersToQuery(filters: FilterState): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.sort) query.sort = filters.sort;
  if (filters.maxTransfers !== "") query.mt = filters.maxTransfers;
  if (filters.modes !== ALL_MODES) query.md = filters.modes;
  if (filters.maxWalk) query.wk = filters.maxWalk;
  if (filters.extraTransfer) query.xt = filters.extraTransfer;
  if (filters.maxTravel) query.tv = filters.maxTravel;
  if (filters.stepFree) query.sf = "1";
  if (filters.via?.id) {
    query.via = filters.via.id;
    if (filters.viaStay !== "0") query.vs = filters.viaStay;
  }
  const date = filters.date || todayInput();
  if (hasDepartWindow(filters)) {
    const [from, to] = windowMinutes(date, filters.departFrom, filters.departTo);
    query.df = String(from);
    query.dt = String(to);
  }
  if (hasArriveWindow(filters)) {
    let [from, to] = windowMinutes(date, filters.arriveFrom, filters.arriveTo);
    // An arrival window reaching before the departure window means the next day.
    if (query.df && from < Number(query.df)) {
      from += DAY_MINUTES;
      to += DAY_MINUTES;
    }
    query.af = String(from);
    query.al = String(to);
  }
  return query;
}

/** A short description for the results header. */
export function windowLabel(filters: FilterState): string | undefined {
  const parts: string[] = [];
  if (hasDepartWindow(filters)) parts.push(`Ab ${filters.departFrom}–${filters.departTo}`);
  if (hasArriveWindow(filters)) parts.push(`An ${filters.arriveFrom}–${filters.arriveTo}`);
  return parts.length ? parts.join(" · ") : undefined;
}
