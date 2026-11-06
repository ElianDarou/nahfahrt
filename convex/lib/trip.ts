import { tidyName } from "./journeys";

export interface UpstreamStop {
  name?: string;
  arrival?: string;
  scheduledArrival?: string;
  departure?: string;
  scheduledDeparture?: string;
  track?: string;
  scheduledTrack?: string;
  cancelled?: boolean;
  lat?: number;
  lon?: number;
}

export interface UpstreamTrip {
  legs?: {
    realTime?: boolean;
    cancelled?: boolean;
    from: UpstreamStop;
    to: UpstreamStop;
    intermediateStops?: UpstreamStop[];
  }[];
}

/**
 * A stop of the travelled part of a trip. Times are minutes since the Unix epoch.
 * Updates during a journey leave out name and scheduled times, which do not change.
 */
export interface TripStop {
  /** Name. */
  n?: string;
  /** Scheduled arrival. */
  a?: number;
  /** Scheduled departure. */
  d?: number;
  /** Arrival delay in minutes, when different from zero. */
  x?: number;
  /** Departure delay in minutes, when different from zero. */
  y?: number;
  /** Platform. */
  g?: string;
  /** 1 when the platform differs from the schedule. */
  p?: 1;
  /** 1 when this stop is cancelled. */
  c?: 1;
  /** Latitude to four decimals, about ten metres. */
  la?: number;
  /** Longitude to four decimals, about ten metres. */
  lo?: number;
}

export interface TripPayload {
  s: TripStop[];
  /** 1 when live data exists. */
  r?: 1;
  /** 1 when the trip is cancelled. */
  c?: 1;
}

const roundCoordinate = (value: number): number => Math.round(value * 10000) / 10000;

const minutes = (iso: string | undefined): number | undefined =>
  iso ? Math.round(Date.parse(iso) / 60000) : undefined;

function delay(actual: string | undefined, scheduled: string | undefined): number {
  const actualMinutes = minutes(actual);
  const scheduledMinutes = minutes(scheduled);
  return actualMinutes === undefined || scheduledMinutes === undefined
    ? 0
    : actualMinutes - scheduledMinutes;
}

/**
 * Cuts a trip down to the part between boarding and alighting.
 * Matching uses scheduled times, as delays change and stop names can repeat on a line.
 */
export function mapTrip(
  trip: UpstreamTrip,
  boardAt: number,
  alightAt: number,
  update: boolean,
): TripPayload {
  const legs = trip.legs ?? [];
  const stops = legs.flatMap((leg) => [leg.from, ...(leg.intermediateStops ?? []), leg.to]);

  const foundBoard = stops.findIndex((stop) => minutes(stop.scheduledDeparture) === boardAt);
  const board = Math.max(0, foundBoard);
  const foundAlight = stops.findIndex(
    (stop, index) => index > board && minutes(stop.scheduledArrival) === alightAt,
  );
  const alight = foundAlight >= 0 ? foundAlight : stops.length - 1;

  const payload: TripPayload = {
    s: stops.slice(board, alight + 1).map((stop) => {
      const out: TripStop = {};
      if (!update) {
        out.n = tidyName(stop.name);
        const arrival = minutes(stop.scheduledArrival);
        const departure = minutes(stop.scheduledDeparture);
        if (arrival !== undefined) out.a = arrival;
        if (departure !== undefined) out.d = departure;
        if (stop.lat !== undefined && stop.lon !== undefined) {
          out.la = roundCoordinate(stop.lat);
          out.lo = roundCoordinate(stop.lon);
        }
      }
      const arrivalDelay = delay(stop.arrival, stop.scheduledArrival);
      const departureDelay = delay(stop.departure, stop.scheduledDeparture);
      if (arrivalDelay !== 0) out.x = arrivalDelay;
      if (departureDelay !== 0) out.y = departureDelay;
      if (stop.track) out.g = stop.track;
      if (stop.track && stop.scheduledTrack && stop.track !== stop.scheduledTrack) out.p = 1;
      if (stop.cancelled) out.c = 1;
      return out;
    }),
  };
  if (legs.some((leg) => leg.realTime)) payload.r = 1;
  if (legs.length && legs.every((leg) => leg.cancelled)) payload.c = 1;
  return payload;
}
