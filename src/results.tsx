import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Journey, TransitLeg } from "../convex/lib/journeys";
import { errorText, searchJourneys } from "./api";
import {
  actualDeparture,
  dayKey,
  formatDay,
  formatDuration,
  formatTime,
  formatTimeMs,
  isCancelled,
  isWalk,
  journeyKey,
  totalMinutes,
  transferRisk,
  transfers,
  vehicles,
} from "./format";
import { BackIcon, BookmarkIcon, ChevronIcon, RefreshIcon } from "./icons";
import { getSaved, removeSaved, saveJourney, savedKey } from "./saved";
import { displayName, loadJourneys, saveJourneys, type Station } from "./store";

export interface When {
  /** Milliseconds since the epoch; absent means "now". */
  at?: number;
  arriveBy: boolean;
  /** Query parameters of chosen filters. */
  filters?: Record<string, string>;
  /** Replaces the requested time in the header. */
  label?: string;
}

/** Live data is not to be expected further ahead than this. */
const LIVE_HORIZON_MINUTES = 60;

const MODE_NAMES: Record<string, string> = {
  B: "Bus",
  T: "Tram",
  U: "U-Bahn",
  S: "S-Bahn",
  R: "Zug",
  F: "Fähre",
  O: "Linie",
};

function Time(props: { scheduled: number; delay?: number; live?: boolean }) {
  const delay = props.delay ?? 0;
  return (
    <span class="time">
      <span class={delay ? "time-old" : props.live ? "time-live" : ""}>
        {formatTime(props.scheduled)}
      </span>
      {delay !== 0 && (
        <span class={delay > 0 ? "time-late" : "time-live"}>{formatTime(props.scheduled + delay)}</span>
      )}
    </span>
  );
}

const lineLabel = (leg: TransitLeg): string => leg.n || MODE_NAMES[leg.m] || "Linie";

function LineChip({ leg }: { leg: TransitLeg }) {
  return (
    <span class={`chip mode-${leg.m}${leg.c ? " chip-cancelled" : ""}`} title={MODE_NAMES[leg.m]}>
      {lineLabel(leg)}
    </span>
  );
}

function Details({ journey, now }: { journey: Journey; now: number }) {
  const list = transfers(journey);
  let vehicleIndex = -1;
  return (
    <ol class="details">
      {journey.l.map((leg, index) => {
        if (isWalk(leg)) {
          const next = journey.l[index + 1];
          const inTransfer = vehicleIndex >= 0 && next && !isWalk(next);
          const buffer = inTransfer ? list[vehicleIndex]?.minutes : undefined;
          return (
            <li class="detail-walk" key={index}>
              Zu Fuß {leg.d} Min.
              {buffer !== undefined && ` · ${buffer} Min. Umstiegszeit`}
            </li>
          );
        }
        vehicleIndex += 1;
        const noLive = !leg.r && actualDeparture(leg) - now < LIVE_HORIZON_MINUTES;
        return (
          <li class={`detail-leg${leg.c ? " detail-cancelled" : ""}`} key={index}>
            <div class="detail-line">
              <LineChip leg={leg} />
              {leg.h && <span class="detail-headsign">Richtung {leg.h}</span>}
            </div>
            {leg.e && <p class="note">Ersatzverkehr</p>}
            {leg.c && <p class="note note-bad">Fällt aus</p>}
            <div class="detail-stop">
              <Time scheduled={leg.a} delay={leg.x} live={!!leg.r} />
              <span class="detail-name">{leg.f}</span>
              {leg.g && <span class="platform">Gl. {leg.g}</span>}
            </div>
            <div class="detail-stop">
              <Time scheduled={leg.b} delay={leg.y} live={!!leg.r} />
              <span class="detail-name">{leg.t}</span>
              {leg.k && <span class="platform">Gl. {leg.k}</span>}
            </div>
            {noLive && <p class="note">Keine Live-Daten</p>}
            {leg.w?.map((text) => (
              <p class="note note-bad" key={text}>
                {text}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function Card(props: {
  journey: Journey;
  now: number;
  saved: boolean;
  onToggleSave: () => void;
  onFollow: () => void;
}) {
  const { journey, now, saved } = props;
  const [open, setOpen] = useState(false);
  const legs = vehicles(journey);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const cancelled = isCancelled(journey);
  const risk = transferRisk(journey);
  const firstLeg = journey.l[0];
  const walkAtStart = isWalk(firstLeg) && firstLeg.d >= 10 ? firstLeg.d : 0;
  return (
    <li class={`card${cancelled ? " card-cancelled" : ""}`}>
      <button type="button" class="card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="card-times">
          <Time scheduled={first.a} delay={first.x} live={!!first.r} />
          <span class="card-dash">–</span>
          <Time scheduled={last.b} delay={last.y} live={!!last.r} />
        </span>
        <span class="card-lines">
          {walkAtStart > 0 && <span class="chip chip-walk">{walkAtStart} Min. zu Fuß</span>}
          {legs.map((leg, index) => (
            <LineChip leg={leg} key={index} />
          ))}
        </span>
        <span class="card-foot">
          <span>
            {formatDuration(totalMinutes(journey))}
            {" · "}
            {journey.u === 0 ? "direkt" : journey.u === 1 ? "1 Umstieg" : `${journey.u} Umstiege`}
            {" · ab "}
            {first.f}
            {first.g ? `, Gl. ${first.g}` : ""}
          </span>
          <ChevronIcon open={open} />
        </span>
        {cancelled && <span class="note note-bad">Fällt aus</span>}
        {!cancelled && risk === "broken" && (
          <span class="note note-bad">Anschluss nicht erreichbar</span>
        )}
        {!cancelled && risk === "tight" && <span class="note note-warn">Knapper Umstieg</span>}
      </button>
      <button
        type="button"
        class="icon-button card-save"
        aria-label={saved ? "Nicht mehr merken" : "Verbindung merken"}
        aria-pressed={saved}
        onClick={props.onToggleSave}
      >
        <BookmarkIcon filled={saved} />
      </button>
      {open && (
        <>
          <Details journey={journey} now={now} />
          <div class="card-actions">
            <button type="button" class="text-button" onClick={props.onFollow}>
              Live verfolgen
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function unique(journeys: Journey[]): Journey[] {
  const seen = new Set<string>();
  return journeys.filter((journey) => {
    const key = journeyKey(journey);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const sortByDeparture = (journeys: Journey[]): Journey[] =>
  [...journeys].sort(
    (left, right) => actualDeparture(vehicles(left)[0]) - actualDeparture(vehicles(right)[0]),
  );

export function Results(props: {
  from: Station;
  to: Station;
  when: When;
  /** False while the live view lies on top. */
  visible: boolean;
  onBack: () => void;
  onFollow: (key: string) => void;
}) {
  const { from, to, when } = props;
  const [savedKeys, setSavedKeys] = useState(() => new Set(getSaved().map((entry) => entry.key)));
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasFilters = !!when.filters && Object.keys(when.filters).length > 0;

  const refreshSaved = () => setSavedKeys(new Set(getSaved().map((entry) => entry.key)));
  // The live view can forget a connection while this screen waits beneath it.
  useEffect(() => {
    if (props.visible) refreshSaved();
  }, [props.visible]);
  const showToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 3000);
  };
  const toggleSave = (journey: Journey) => {
    const key = savedKey(journey);
    if (savedKeys.has(key)) {
      removeSaved(key);
      showToast("Nicht mehr gemerkt");
    } else {
      saveJourney(displayName(from), displayName(to), journey);
      showToast("Gemerkt, du findest sie auf der Startseite");
    }
    refreshSaved();
  };
  const follow = (journey: Journey) => {
    const key = savedKey(journey);
    if (!savedKeys.has(key)) saveJourney(displayName(from), displayName(to), journey);
    refreshSaved();
    props.onFollow(key);
  };
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [earlier, setEarlier] = useState<string>();
  const [later, setLater] = useState<string>();
  const [walkOnly, setWalkOnly] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 60000));
  const requestRef = useRef<AbortController | undefined>(undefined);

  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(undefined);
    const at = when.at ?? Date.now();
    setNow(Math.floor(Date.now() / 60000));

    searchJourneys({ from, to, at, arriveBy: when.arriveBy, filters: when.filters }, controller.signal)
      .then((payload) => {
        setJourneys(payload.j);
        setEarlier(payload.p);
        setLater(payload.n);
        setWalkOnly(payload.w);
        setSavedAt(undefined);
        if (when.at === undefined && !hasFilters) saveJourneys(from, to, payload);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorText(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [from, to, when]);

  useEffect(() => {
    // Saved results appear at once and stay useful without network.
    if (when.at === undefined && !hasFilters) {
      const cached = loadJourneys(from, to);
      const current = Math.floor(Date.now() / 60000);
      const upcoming = cached?.payload.j.filter(
        (journey) => actualDeparture(vehicles(journey)[0]) >= current,
      );
      if (cached && upcoming?.length) {
        setJourneys(upcoming);
        setSavedAt(cached.savedAt);
      }
    }
    load();
    return () => requestRef.current?.abort();
  }, [load, from, to, when.at]);

  const page = async (direction: "earlier" | "later") => {
    const cursor = direction === "earlier" ? earlier : later;
    if (!cursor || paging) return;
    setPaging(true);
    setError(undefined);
    try {
      const payload = await searchJourneys({
        from,
        to,
        at: when.at ?? Date.now(),
        arriveBy: when.arriveBy,
        cursor,
        filters: when.filters,
      });
      setJourneys((known) =>
        when.filters?.sort
          ? unique([...known, ...payload.j])
          : sortByDeparture(unique([...known, ...payload.j])),
      );
      if (direction === "earlier") setEarlier(payload.p);
      else setLater(payload.n);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPaging(false);
    }
  };

  const baseLabel = when.label
    ? when.label
    : when.at
    ? `${when.arriveBy ? "An" : "Ab"} ${formatDay(when.at / 60000)}, ${formatTimeMs(when.at)}`
    : "Ab jetzt";
  const filterCount = when.filters
    ? Object.keys(when.filters).filter((key) => !["df", "dt", "af", "al", "vs"].includes(key)).length
    : 0;
  const requestLabel =
    filterCount > 0
      ? `${baseLabel} · ${filterCount === 1 ? "1 Filter" : `${filterCount} Filter`}`
      : baseLabel;

  let previousDay =
    when.filters?.df || when.filters?.al
      ? dayKey(Number(when.filters.df ?? when.filters.al))
      : when.at
        ? dayKey(when.at / 60000)
        : dayKey(now);

  return (
    <div class="screen">
      <header class="bar bar-results">
        <button type="button" class="icon-button" aria-label="Zurück" onClick={props.onBack}>
          <BackIcon />
        </button>
        <div class="bar-title">
          <h1>
            {displayName(from)} → {displayName(to)}
          </h1>
          <p>{requestLabel}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="Aktualisieren"
          disabled={loading}
          onClick={load}
        >
          {loading ? <span class="spinner" role="status" aria-label="Lädt" /> : <RefreshIcon />}
        </button>
      </header>

      <div class="scroll results">
        {savedAt !== undefined && (
          <p class="banner">
            Gespeichert von {formatTimeMs(savedAt)} Uhr
            {loading ? ", wird aktualisiert" : ""}. Verspätungen können sich geändert haben.
          </p>
        )}
        {error && (
          <div class="banner banner-bad" role="alert">
            <p>{error}</p>
            <button type="button" class="text-button" onClick={load}>
              Erneut versuchen
            </button>
          </div>
        )}
        {walkOnly !== undefined && (
          <p class="banner">Zu Fuß wärst du in {walkOnly} Min. da.</p>
        )}

        {earlier && journeys.length > 0 && (
          <button
            type="button"
            class="page-button"
            disabled={paging}
            onClick={() => page("earlier")}
          >
            Frühere Verbindungen
          </button>
        )}

        {!loading && !error && journeys.length === 0 && (
          <p class="hint">
            {hasFilters
              ? "Keine Verbindung mit diesen Filtern gefunden. Lockere sie etwas."
              : "Keine Verbindung mit dem Deutschlandticket gefunden."}
          </p>
        )}
        {loading && journeys.length === 0 && !error && (
          <ul class="cards" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li class="card card-skeleton" key={index} />
            ))}
          </ul>
        )}

        {journeys.length > 0 && (
          <ul class="cards">
            {journeys.flatMap((journey) => {
              const key = journeyKey(journey);
              const day = dayKey(actualDeparture(vehicles(journey)[0]));
              const changed = day !== previousDay;
              previousDay = day;
              return [
                ...(changed
                  ? [
                      <li class="day-separator" key={`day-${day}`}>
                        {formatDay(actualDeparture(vehicles(journey)[0]))}
                      </li>,
                    ]
                  : []),
                <Card
                  journey={journey}
                  now={now}
                  key={key}
                  saved={savedKeys.has(savedKey(journey))}
                  onToggleSave={() => toggleSave(journey)}
                  onFollow={() => follow(journey)}
                />,
              ];
            })}
          </ul>
        )}

        {later && journeys.length > 0 && (
          <button
            type="button"
            class="page-button"
            disabled={paging}
            onClick={() => page("later")}
          >
            Spätere Verbindungen
          </button>
        )}

        {journeys.length > 0 && (
          <p class="legal">
            Der Deutschlandticket-Filter ist eine Näherung. Einzelne Ausnahmen, etwa IC-Strecken mit
            Ticketanerkennung, können fehlen. Prüfe die Gültigkeit im Zweifel vor der Fahrt.
          </p>
        )}
      </div>
      {toast && (
        <p class="toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}
