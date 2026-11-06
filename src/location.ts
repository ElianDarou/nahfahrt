import { ApiError } from "./api";
import type { Station } from "./store";

/**
 * A position lives in memory only. Nothing in this file writes it anywhere, and the
 * "Mein Standort" entry in the search fields holds no coordinates at all.
 */
export interface Fix {
  lat: number;
  lon: number;
  /** Metres. */
  accuracy: number;
  /** Milliseconds since the epoch. */
  at: number;
}

const toFix = (position: GeolocationPosition): Fix => ({
  lat: position.coords.latitude,
  lon: position.coords.longitude,
  accuracy: position.coords.accuracy,
  at: position.timestamp,
});

const toError = (error: GeolocationPositionError): ApiError =>
  new ApiError(
    error.code === error.PERMISSION_DENIED
      ? "location_denied"
      : error.code === error.TIMEOUT
        ? "location_timeout"
        : "location_off",
  );

const ask = (options: PositionOptions): Promise<Fix> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new ApiError("location_off"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toFix(position)),
      (error) => reject(toError(error)),
      options,
    );
  });

/** The satellite fix when there is one; indoors, what the network knows beats nothing. */
export async function currentPosition(): Promise<Fix> {
  try {
    return await ask({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 20_000 });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "location_timeout") throw error;
    return ask({ enableHighAccuracy: false, timeout: 8_000, maximumAge: 120_000 });
  }
}

/** Fills in "Mein Standort" for one request; everything else passes through unchanged. */
export async function withPosition(station: Station): Promise<Station> {
  if (!station.me) return station;
  const fix = await currentPosition();
  // The backend accepts seven decimals; six are about ten centimetres.
  return { ...station, lat: Number(fix.lat.toFixed(6)), lon: Number(fix.lon.toFixed(6)) };
}

/** Follows the position while the app is in view. Returns how to stop. */
export function watchPosition(
  onFix: (fix: Fix) => void,
  onError: (error: ApiError) => void,
): () => void {
  if (!navigator.geolocation) {
    onError(new ApiError("location_off"));
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    (position) => onFix(toFix(position)),
    (error) => onError(toError(error)),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

const GPS_PREFERENCE = "nf.liveGps.v1";

/** Whether the user switched the live position on. This yes or no is all that is stored. */
export function liveGpsWanted(): boolean {
  try {
    return localStorage.getItem(GPS_PREFERENCE) === "1";
  } catch {
    return false;
  }
}

export function setLiveGpsWanted(wanted: boolean): void {
  try {
    if (wanted) localStorage.setItem(GPS_PREFERENCE, "1");
    else localStorage.removeItem(GPS_PREFERENCE);
  } catch {
    // Then the switch simply starts off again next time.
  }
}
