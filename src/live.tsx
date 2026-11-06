import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { TransitLeg } from "../convex/lib/journeys";
import type { TripStop } from "../convex/lib/trip";
import { ApiError, errorText, followTrip } from "./api";
import {
  actualArrival,
  actualDeparture,
  formatDay,
  formatTime,
  formatTimeMs,
  isWalk,
  transferRisk,
  transfers,
  vehicles,
} from "./format";
import { BackIcon, BellIcon, ChevronIcon, LocationIcon, RefreshIcon, ShareIcon } from "./icons";
import { liveGpsWanted, setLiveGpsWanted, watchPosition, type Fix } from "./location";
import {
  describePosition,
  formatDistance,
  planned,
  scheduleText,
  type Position,
  type RouteMatch,
} from "./position";
import { journeyStart, progressOf, type Progress } from "./progress";
import { canRemind, forgetSaved, setBell, syncReminders } from "./reminders";
import {
  applyTrip,
  findSaved,
  hasCoordinates,
  storeSaved,
  vehiclesToFollow,
  type SavedJourney,
} from "./saved";
import { StationButton } from "./station-sheet";
import type { StopRef } from "./stops";

const POLL_MS = 60_000;
const CLOCK_MS = 15_000;
/** Earlier than this before leaving, a position says nothing about the journey. */
const GPS_HORIZON_MINUTES = 180;

function StopTime(props: { scheduled?: number; delay?: number; live: boolean }) {
  if (props.scheduled === undefined) return <span class="stop-time" />;
  const delay = props.delay ?? 0;
  return (
    <span class="stop-time">
      {delay !== 0 && <span class="time-old">{formatTime(props.scheduled)}</span>}
      <span class={delay > 0 ? "time-late" : props.live ? "time-live" : ""}>
        {formatTime(props.scheduled + delay)}
      </span>
    </span>
  );
}

function StopRow(props: {
  stop: TripStop;
  state: "passed" | "here" | "next";
  live: boolean;
  isLast: boolean;
  /** The stop's first and last place in a vehicle's list are enough to find it without coordinates. */
  stationRef: StopRef;
  onStation: (stop: StopRef) => void;
}) {
  const { stop, isLast } = props;
  const useArrival = isLast || stop.d === undefined;
  return (
    <li class={`stop stop-${props.state}${stop.c ? " stop-cancelled" : ""}`}>
      <span class="stop-dot" aria-hidden="true" />
      <StopTime
        scheduled={useArrival ? stop.a : stop.d}
        delay={useArrival ? stop.x : stop.y}
        live={props.live}
      />
      <StationButton class="stop-name" stop={props.stationRef} onOpen={props.onStation}>
        {stop.n}
        {stop.c && <span class="note note-bad"> Halt entfällt</span>}
      </StationButton>
      {stop.g && (
        <span class={stop.p ? "platform platform-changed" : "platform"}>
          Gl. {stop.g}
          {stop.p ? " (neu)" : ""}
        </span>
      )}
    </li>
  );
}

function VehicleBlock(props: {
  leg: TransitLeg;
  stops?: TripStop[];
  isCurrent: boolean;
  stopsPassed: number;
  atStop: boolean;
  finished: boolean;
  /** True when the markers come from a real position rather than the clock. */
  gps: boolean;
  /** Where the schedule says this vehicle should be, shown beside the real position. */
  plannedAt?: number;
  onStation: (stop: StopRef) => void;
}) {
  const { leg, isCurrent, stopsPassed, atStop, finished, gps, plannedAt } = props;
  const stops: TripStop[] = props.stops?.length
    ? props.stops
    : [
        { n: leg.f, d: leg.a, y: leg.x, g: leg.g },
        { n: leg.t, a: leg.b, x: leg.y, g: leg.k },
      ];
  const [expanded, setExpanded] = useState(isCurrent);
  useEffect(() => {
    if (isCurrent) setExpanded(true);
  }, [isCurrent]);

  const live = !!leg.r;
  const hidden = stops.length - 2;
  const stateOf = (index: number): "passed" | "here" | "next" => {
    if (finished) return "passed";
    if (!isCurrent) return "next";
    if (atStop && index === stopsPassed - 1) return "here";
    return index < stopsPassed ? "passed" : "next";
  };
  const showMarker = isCurrent && !atStop && stopsPassed > 0 && stopsPassed < stops.length;

  const rows = expanded ? stops.map((stop, index) => ({ stop, index })) : [
    { stop: stops[0], index: 0 },
    { stop: stops[stops.length - 1], index: stops.length - 1 },
  ];

  return (
    <li class={`vehicle mode-line-${leg.m}${leg.c ? " vehicle-cancelled" : ""}`}>
      <div class="detail-line">
        <span class={`chip mode-${leg.m}${leg.c ? " chip-cancelled" : ""}`}>{leg.n}</span>
        {leg.h && <span class="detail-headsign">Richtung {leg.h}</span>}
      </div>
      {leg.e && <p class="note">Ersatzverkehr</p>}
      {leg.c && <p class="note note-bad">Fällt aus</p>}
      <ol class="stops">
        {rows.map(({ stop, index }, position) => (
          <>
            {!expanded && position === 1 && hidden > 0 && (
              <li class="stops-toggle" key="toggle">
                <button type="button" class="text-button" onClick={() => setExpanded(true)}>
                  {hidden === 1 ? "1 Zwischenhalt" : `${hidden} Zwischenhalte`}
                  <ChevronIcon open={false} />
                </button>
              </li>
            )}
            {expanded && showMarker && index === stopsPassed && (
              <li class="here-marker" key="here">
                <span class="here-dot" aria-hidden="true" />
                {gps ? "Du bist hier" : "Du bist ungefähr hier"}
              </li>
            )}
            {expanded &&
              plannedAt === index &&
              !(showMarker && stopsPassed === plannedAt) && (
                <li class="here-marker here-marker-plan" key="plan">
                  <span class="here-dot here-dot-plan" aria-hidden="true" />
                  Laut Fahrplan hier
                </li>
              )}
            <StopRow
              key={index}
              stop={stop}
              state={stateOf(index)}
              live={live}
              isLast={index === stops.length - 1}
              stationRef={{
                name: stop.n ?? "",
                lat: stop.la,
                lon: stop.lo,
                leg,
                end:
                  index === 0 ? "from" : index === stops.length - 1 ? "to" : undefined,
              }}
              onStation={props.onStation}
            />
          </>
        ))}
      </ol>
      {expanded && !isCurrent && hidden > 0 && (
        <button type="button" class="text-button" onClick={() => setExpanded(false)}>
          Zwischenhalte ausblenden
          <ChevronIcon open={true} />
        </button>
      )}
      {leg.w?.map((text) => (
        <p class="note note-bad" key={text}>
          {text}
        </p>
      ))}
    </li>
  );
}

/** In a tunnel or deep inside a train the signal goes; an old position should say so. */
const STALE_FIX_MINUTES = 2;

function PositionCard(props: {
  position: Position | null;
  error?: string;
  waiting: boolean;
  /** Minutes since the position was measured. */
  age: number;
}) {
  const { position, error, waiting, age } = props;
  if (error) return <p class="position position-note">{error}</p>;
  if (waiting) return <p class="position position-note">Standort wird gesucht …</p>;
  if (!position) return null;
  if (position.kind === "weak") {
    return (
      <p class="position position-note">
        Das GPS-Signal ist noch zu ungenau (etwa {formatDistance(position.accuracy)}).
      </p>
    );
  }
  if (position.kind === "walk") {
    const { stop, metres, atStop, walkMinutes, minutesLeft } = position;
    const short = walkMinutes - minutesLeft;
    const warning = atStop || short <= 0 ? undefined : short <= 2 ? "Das wird knapp" : "Zu Fuß reicht die Zeit wohl nicht";
    return (
      <dl class="position">
        <div>
          <dt>Du</dt>
          <dd>
            {atStop ? `An ${stop}` : `Noch ${formatDistance(metres)} bis ${stop} (Luftlinie)`}
            {!atStop && <small>Etwa {walkMinutes} Min. zu Fuß, {minutesLeft} Min. bis zur Abfahrt</small>}
            {warning && <small class="note-warn">{warning}</small>}
          </dd>
        </div>
        <div>
          <dt>Fahrplan</dt>
          <dd>{position.plan}</dd>
        </div>
      </dl>
    );
  }
  if (position.kind === "off") {
    return (
      <dl class="position">
        <div>
          <dt>Du</dt>
          <dd>
            {formatDistance(position.metres)} abseits der Strecke
            <small>Bist du noch nicht eingestiegen?</small>
          </dd>
        </div>
        <div>
          <dt>Fahrplan</dt>
          <dd>{position.plan}</dd>
        </div>
      </dl>
    );
  }
  const { match } = position;
  const on = Math.abs(match.behindSchedule) <= 1;
  const stale = age >= STALE_FIX_MINUTES;
  return (
    <dl class="position">
      <div>
        <dt>Du</dt>
        <dd>
          {match.where}
          {stale ? (
            <small>Letztes GPS-Signal vor {Math.floor(age)} Min.</small>
          ) : (
            <small class={on ? "time-live" : match.behindSchedule > 0 ? "time-late" : "time-live"}>
              {scheduleText(match.behindSchedule)}
            </small>
          )}
        </dd>
      </div>
      <div>
        <dt>Fahrplan</dt>
        <dd>{position.plan}</dd>
      </div>
    </dl>
  );
}

export function Live(props: {
  savedKey: string;
  onBack: () => void;
  onShare: (from: string, to: string, journey: SavedJourney["journey"]) => void;
  onStation: (stop: StopRef) => void;
  onToast: (text: string) => void;
}) {
  const [entry, setEntry] = useState<SavedJourney | undefined>(() => findSaved(props.savedKey));
  const [now, setNow] = useState(() => Date.now() / 60000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const entryRef = useRef(entry);
  const running = useRef(false);
  const [gpsOn, setGpsOn] = useState(liveGpsWanted);
  // Held in memory only: it is never part of the saved entry and leaves the phone in no request.
  const [fix, setFix] = useState<Fix>();
  const fixRef = useRef<Fix | undefined>(undefined);
  const [gpsError, setGpsError] = useState<string>();
  const [bellBusy, setBellBusy] = useState(false);

  const load = useCallback(async (indexes: number[]) => {
    const current = entryRef.current;
    if (!current || running.current) return;
    running.current = true;
    setLoading(true);
    setError(undefined);
    try {
      let working = current;
      const legs = vehicles(current.journey);
      for (const index of indexes) {
        const leg = legs[index];
        if (!leg?.i) continue;
        const known = working.stops[index];
        const request = (update: boolean) =>
          followTrip({ id: leg.i!, boardAt: leg.a, alightAt: leg.b, update });
        let updated = hasCoordinates(known)
          ? applyTrip(working, index, await request(true), true)
          : applyTrip(working, index, await request(false), false);
        // The stop list changed, so ask once for all of it.
        if (!updated) updated = applyTrip(working, index, await request(false), false);
        if (updated) working = updated;
      }
      // The bell can change while the answers are on their way.
      const { bell: _bell, ...rest } = working;
      working = entryRef.current?.bell ? { ...rest, bell: 1 } : rest;
      entryRef.current = working;
      setEntry(working);
      storeSaved(working);
      void syncReminders(working).catch(() => undefined);
    } catch (failure) {
      // An old trip id only costs the extra stops, not the saved journey.
      if (!(failure instanceof ApiError && failure.code === "unknown_trip")) {
        setError(errorText(failure));
      }
    } finally {
      running.current = false;
      setLoading(false);
    }
  }, []);

  const follow = useCallback(() => {
    const current = entryRef.current;
    if (!current || document.hidden) return;
    const indexes = vehiclesToFollow(current.journey, Date.now() / 60000);
    if (indexes.length) void load(indexes);
  }, [load]);

  const loadAll = useCallback(() => {
    const current = entryRef.current;
    if (current) void load(vehicles(current.journey).map((_, index) => index));
  }, [load]);

  useEffect(() => {
    // Stop lists are fetched once, on opening; afterwards only changes travel.
    const current = entryRef.current;
    if (current) {
      const missing = vehicles(current.journey).flatMap((_, index) =>
        hasCoordinates(current.stops[index]) ? [] : [index],
      );
      const toFollow = vehiclesToFollow(current.journey, Date.now() / 60000);
      const indexes = [...new Set([...missing, ...toFollow])];
      if (indexes.length) void load(indexes);
    }
    const clock = setInterval(() => setNow(Date.now() / 60000), CLOCK_MS);
    const poll = setInterval(follow, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        setNow(Date.now() / 60000);
        follow();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [follow, load]);

  const start = entry ? journeyStart(entry.journey) : 0;
  const finishedAlready = entry ? progressOf(entry.journey, entry.stops, now).phase === "arrived" : true;
  const gpsActive = gpsOn && !finishedAlready && start - now <= GPS_HORIZON_MINUTES;

  // The position is only followed in view, which also keeps the battery out of it.
  useEffect(() => {
    if (!gpsActive) {
      fixRef.current = undefined;
      setFix(undefined);
      return;
    }
    let stop: (() => void) | undefined;
    const begin = () => {
      stop?.();
      stop = watchPosition(
        (next) => {
          fixRef.current = next;
          setFix(next);
          setGpsError(undefined);
        },
        (failure) => {
          // A lost signal is normal on a train: the last position stays, marked by its age.
          if (failure.code === "location_timeout" && fixRef.current) return;
          setGpsError(errorText(failure));
        },
      );
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop?.();
        stop = undefined;
      } else {
        begin();
      }
    };
    if (!document.hidden) begin();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gpsActive]);

  if (!entry) {
    return (
      <div class="screen">
        <header class="bar">
          <button type="button" class="icon-button" aria-label="Zurück" onClick={props.onBack}>
            <BackIcon />
          </button>
          <h1>Abgelaufen</h1>
        </header>
        <p class="hint">Diese Verbindung ist vorbei und wurde entfernt.</p>
      </div>
    );
  }

  const { journey } = entry;
  const legs = vehicles(journey);
  const progress = progressOf(journey, entry.stops, now);
  const list = transfers(journey);
  const risk = transferRisk(journey);
  const anyCancelled = legs.some((leg) => leg.c);
  const anyLive = legs.some((leg) => leg.r);
  const arrived = progress.phase === "arrived";
  const started = progress.phase !== "upcoming";
  const position = gpsActive && fix ? describePosition(journey, entry.stops, fix, now) : null;
  const gpsMatch: RouteMatch | undefined = position?.kind === "route" ? position.match : undefined;
  const plan: Progress | undefined = gpsMatch ? planned(journey, entry.stops, now) : undefined;
  let vehicleIndex = -1;

  return (
    <div class="screen">
      <header class="bar bar-results">
        <button type="button" class="icon-button" aria-label="Zurück" onClick={props.onBack}>
          <BackIcon />
        </button>
        <div class="bar-title">
          <h1>
            {entry.from} → {entry.to}
          </h1>
          <p>{formatDay(journeyStart(journey))}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="Aktualisieren"
          disabled={loading}
          onClick={loadAll}
        >
          {loading ? <span class="spinner" role="status" aria-label="Lädt" /> : <RefreshIcon />}
        </button>
      </header>

      <div class="scroll results">
        <section class={`status phase-${progress.phase}`} aria-live="polite">
          <p class="status-headline">{progress.headline}</p>
          {progress.detail && <p class="status-detail">{progress.detail}</p>}
          <div
            class="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.share * 100)}
            aria-label="Fortschritt der Reise"
          >
            <span style={{ width: `${progress.share * 100}%` }} />
          </div>
          <div class="status-times">
            <span>{formatTime(actualDeparture(legs[0]))}</span>
            <span>{formatTime(actualArrival(legs[legs.length - 1]))}</span>
          </div>
          <p class="status-source">
            {entry.updatedAt
              ? `${anyLive ? "Live-Daten" : "Fahrplan, noch keine Live-Daten"}, Stand ${formatTimeMs(entry.updatedAt)} Uhr`
              : "Nach Fahrplan"}
          </p>
        </section>

        <div class="live-actions">
          <button
            type="button"
            class={gpsOn ? "live-action live-action-on" : "live-action"}
            aria-pressed={gpsOn}
            onClick={() => {
              setLiveGpsWanted(!gpsOn);
              setGpsError(undefined);
              setGpsOn(!gpsOn);
            }}
          >
            <LocationIcon /> Standort
          </button>
          {canRemind() && (
            <button
              type="button"
              class={entry.bell ? "live-action live-action-on" : "live-action"}
              aria-pressed={!!entry.bell}
              disabled={bellBusy}
              onClick={() => {
                setBellBusy(true);
                setBell(entry, !entry.bell)
                  .then((result) => {
                    entryRef.current = result.entry;
                    setEntry(result.entry);
                    props.onToast(result.text);
                  })
                  .catch(() => props.onToast("Die Erinnerung ließ sich nicht einrichten."))
                  .finally(() => setBellBusy(false));
              }}
            >
              <BellIcon on={!!entry.bell} /> Erinnerung
            </button>
          )}
          <button
            type="button"
            class="live-action"
            onClick={() => props.onShare(entry.from, entry.to, journey)}
          >
            <ShareIcon /> Teilen
          </button>
        </div>

        {gpsActive && (
          <PositionCard
            position={position}
            error={gpsError}
            waiting={!fix && !gpsError}
            age={fix ? Math.max(0, now - fix.at / 60000) : 0}
          />
        )}

        {error && (
          <div class="banner banner-bad" role="alert">
            <p>{error} Angezeigt wird der letzte Stand.</p>
          </div>
        )}
        {anyCancelled && (
          <p class="banner banner-bad" role="alert">
            Ein Teil dieser Verbindung fällt aus. Suche am besten eine neue Verbindung.
          </p>
        )}
        {!anyCancelled && risk === "broken" && (
          <p class="banner banner-bad" role="alert">
            Durch die Verspätung ist ein Anschluss nicht mehr erreichbar.
          </p>
        )}

        <ol class="timeline">
          {journey.l.map((leg, index) => {
            if (isWalk(leg)) {
              const next = journey.l[index + 1];
              const transfer =
                vehicleIndex >= 0 && next && !isWalk(next) ? list[vehicleIndex] : undefined;
              return (
                <li class="timeline-walk" key={`walk-${index}`}>
                  Zu Fuß {leg.d} Min.
                  {transfer && ` · ${transfer.minutes} Min. Umstiegszeit`}
                  {transfer && transfer.minutes < 5 && (
                    <span class="note-warn"> · knapp</span>
                  )}
                </li>
              );
            }
            vehicleIndex += 1;
            const current = vehicleIndex;
            // A real position beats what the clock suggests.
            const isCurrent = gpsMatch
              ? gpsMatch.vehicle === current
              : (progress.phase === "riding" || progress.phase === "stopped") &&
                progress.vehicle === current;
            const finished =
              arrived ||
              progress.phase === "final-walk" ||
              (started && current < (gpsMatch?.vehicle ?? progress.vehicle));
            return (
              <VehicleBlock
                key={`${leg.n}-${leg.a}`}
                leg={leg}
                stops={entry.stops[current]}
                isCurrent={isCurrent}
                stopsPassed={isCurrent ? (gpsMatch?.stopsPassed ?? progress.stopsPassed) : 0}
                atStop={isCurrent && (gpsMatch?.atStop ?? progress.atStop)}
                finished={finished}
                gps={!!gpsMatch}
                plannedAt={
                  plan &&
                  (plan.phase === "riding" || plan.phase === "stopped") &&
                  plan.vehicle === current
                    ? plan.stopsPassed
                    : undefined
                }
                onStation={props.onStation}
              />
            );
          })}
        </ol>

        <p class="legal">
          {gpsOn
            ? "Dein Standort wird nur hier auf dem Handy mit der Strecke verglichen und nicht gespeichert. Die Strecke ist eine gerade Linie zwischen den Halten, also eine Näherung."
            : "Ohne Standort ist die Position aus Fahrplan und Live-Daten geschätzt."}{" "}
          Die Verbindung verschwindet nach der Ankunft von selbst.
        </p>
        <button
          type="button"
          class="page-button"
          onClick={() => {
            forgetSaved(entry.key);
            props.onBack();
          }}
        >
          Nicht mehr merken
        </button>
      </div>
    </div>
  );
}
