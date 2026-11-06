import { tidyName } from "./journeys";

export interface UpstreamArea {
  name: string;
  adminLevel?: number;
  default?: boolean;
}

export interface UpstreamMatch {
  type: string;
  name: string;
  id?: string;
  lat: number;
  lon: number;
  country?: string;
  areas?: UpstreamArea[];
}

/** A place as sent to the app. */
export interface Place {
  /** Display name. */
  n: string;
  /** Town, when the name does not already contain it. */
  s?: string;
  /** Stop id, absent for addresses and for stops routed by coordinates. */
  i?: string;
  /** Latitude rounded to five decimals, about one metre. */
  y: number;
  /** Longitude rounded to five decimals, about one metre. */
  x: number;
  /** 1 for addresses, absent for stops. */
  a?: 1;
}

/** Feeds whose stops are ride-sharing points rather than public transport stops. */
const isCarpoolFeed = (id: string | undefined): boolean => !!id && id.startsWith("de-amarillo");

const round = (value: number): number => Math.round(value * 100000) / 100000;

function townOf(match: UpstreamMatch): string | undefined {
  const areas = match.areas ?? [];
  const byLevel = (level: number) => areas.find((area) => area.adminLevel === level)?.name;
  return byLevel(8) ?? byLevel(7) ?? byLevel(6) ?? areas.find((area) => area.default)?.name;
}

const normalize = (text: string): string =>
  text
    .toLocaleLowerCase("de")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function distanceMetres(left: Place, right: Place): number {
  const latitude = (left.y - right.y) * 111_000;
  const longitude = (left.x - right.x) * 74_000;
  return Math.hypot(latitude, longitude);
}

/** Main stations come first, then other stations; otherwise upstream order stays. */
function stationBonus(place: Place): number {
  const name = normalize(place.n);
  if (/\b(hauptbahnhof|hbf)\b/.test(name)) return 2;
  return /\b(bahnhof|bf)\b/.test(name) ? 1 : 0;
}

/** Keeps German results, removes duplicates and shapes them for the app. */
export function mapPlaces(matches: UpstreamMatch[], limit = 10): Place[] {
  const german = matches.filter((match) => match.country === "DE");
  const ordered = [
    ...german.filter((match) => !isCarpoolFeed(match.id)),
    ...german.filter((match) => isCarpoolFeed(match.id)),
  ];

  const places: Place[] = [];
  for (const match of ordered) {
    const name = tidyName(match.name);
    // A ride-sharing point at a real stop adds nothing but confusion.
    if (
      isCarpoolFeed(match.id) &&
      places.some(
        (known) =>
          !known.a && distanceMetres(known, { n: name, y: match.lat, x: match.lon }) < 150,
      )
    ) {
      continue;
    }
    const town = townOf(match);
    const place: Place = { n: name, y: round(match.lat), x: round(match.lon) };
    if (town && !normalize(name).includes(normalize(town))) place.s = town;
    if (match.type === "ADDRESS") place.a = 1;
    else if (match.id && !isCarpoolFeed(match.id)) place.i = match.id;

    const duplicate = places.some(
      (known) =>
        !known.a === !place.a &&
        distanceMetres(known, place) < 150 &&
        (normalize(known.n) === normalize(place.n) ||
          normalize(`${known.s ?? ""} ${known.n}`) === normalize(`${place.s ?? ""} ${place.n}`) ||
          normalize(known.n).endsWith(normalize(place.n)) ||
          normalize(place.n).endsWith(normalize(known.n))),
    );
    if (!duplicate) places.push(place);
  }

  const originalIndex = new Map(places.map((place, index) => [place, index]));
  return places
    .sort(
      (left, right) =>
        stationBonus(right) - stationBonus(left) ||
        originalIndex.get(left)! - originalIndex.get(right)!,
    )
    .slice(0, limit);
}

/** Public transport stops around a position; ride-sharing points are no stops to wait at. */
export const mapNearby = (matches: UpstreamMatch[], limit = 8): Place[] =>
  mapPlaces(
    matches.filter((match) => !isCarpoolFeed(match.id)),
    limit,
  );
