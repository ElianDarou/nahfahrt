import type { Journey } from "../convex/lib/journeys";
import { prefetchTrip } from "./api";
import { journeyKey, vehicles } from "./format";
import { findSaved, hasCoordinates, vehiclesToFollow } from "./saved";

/** How many vehicles of a journey are worth loading ahead. */
const AHEAD = 2;

/**
 * The live view asks for the stops of every vehicle it follows. Doing that once the results
 * are on screen turns opening a connection into plain painting.
 */
export function prefetchTripData(journey: Journey, now = Date.now() / 60000): void {
  const saved = findSaved(journeyKey(journey));
  const legs = vehicles(journey);
  for (const index of vehiclesToFollow(journey, now).slice(0, AHEAD)) {
    const leg = legs[index];
    if (!leg?.i) continue;
    prefetchTrip({
      id: leg.i,
      boardAt: leg.a,
      alightAt: leg.b,
      // A known stop list only needs the changes, exactly as the live view would ask.
      update: hasCoordinates(saved?.stops[index]),
    });
  }
}
