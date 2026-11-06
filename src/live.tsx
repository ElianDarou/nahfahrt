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
import { BackIcon, ChevronIcon, RefreshIcon } from "./icons";
import { journeyStart, progressOf } from "./progress";
import { applyTrip, findSaved, removeSaved, storeSaved, vehiclesToFollow, type SavedJourney } from "./saved";

const POLL_MS = 60_000;
const CLOCK_MS = 15_000;

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
      <span class="stop-name">
        {stop.n}
        {stop.c && <span class="note note-bad"> Halt entfällt</span>}
      </span>
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
}) {
  const { leg, isCurrent, stopsPassed, atStop, finished } = props;
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
                Du bist ungefähr hier
              </li>
            )}
            <StopRow
              key={index}
              stop={stop}
              state={stateOf(index)}
              live={live}
              isLast={index === stops.length - 1}
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

export function Live(props: { savedKey: string; onBack: () => void }) {
  const [entry, setEntry] = useState<SavedJourney | undefined>(() => findSaved(props.savedKey));
  const [now, setNow] = useState(() => Date.now() / 60000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const entryRef = useRef(entry);
  const running = useRef(false);

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
        let updated = known
          ? applyTrip(working, index, await request(true), true)
          : applyTrip(working, index, await request(false), false);
        // The stop list changed, so ask once for all of it.
        if (!updated) updated = applyTrip(working, index, await request(false), false);
        if (updated) working = updated;
      }
      entryRef.current = working;
      setEntry(working);
      storeSaved(working);
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
        current.stops[index] ? [] : [index],
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
            const isCurrent =
              (progress.phase === "riding" || progress.phase === "stopped") &&
              progress.vehicle === current;
            const finished =
              arrived ||
              progress.phase === "final-walk" ||
              (started && current < progress.vehicle);
            return (
              <VehicleBlock
                key={`${leg.n}-${leg.a}`}
                leg={leg}
                stops={entry.stops[current]}
                isCurrent={isCurrent}
                stopsPassed={isCurrent ? progress.stopsPassed : 0}
                atStop={isCurrent && progress.atStop}
                finished={finished}
              />
            );
          })}
        </ol>

        <p class="legal">
          Die Position ist aus Fahrplan und Live-Daten geschätzt, die App nutzt kein GPS. Die
          Verbindung verschwindet nach der Ankunft von selbst.
        </p>
        <button
          type="button"
          class="page-button"
          onClick={() => {
            removeSaved(entry.key);
            props.onBack();
          }}
        >
          Nicht mehr merken
        </button>
      </div>
    </div>
  );
}
