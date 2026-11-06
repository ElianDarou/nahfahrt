import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { AdvancedSearch } from "./advanced";
import {
  defaultFilters,
  filterProblem,
  filtersToQuery,
  hasTimeWindow,
  windowLabel,
  type FilterState,
} from "./filters";
import type { Journey } from "../convex/lib/journeys";
import { formatDay, formatTime, vehicles } from "./format";
import { BellIcon, CloseIcon, SwapIcon } from "./icons";
import { Live } from "./live";
import { Picker } from "./picker";
import { journeyStart, progressOf } from "./progress";
import { Results, type When } from "./results";
import { canRemind, forgetSaved, onReminderTap, setBell, syncAllReminders } from "./reminders";
import { getSaved } from "./saved";
import { ShareSheet } from "./share-sheet";
import { StationSheet } from "./station-sheet";
import {
  displayName,
  displaySub,
  recordRoute,
  recordStationUse,
  removeRoute,
  topRoutes,
  type Station,
} from "./store";
import type { StopRef } from "./stops";

type View = "home" | "pick-from" | "pick-to" | "pick-via" | "results" | "live";
type WhenMode = "now" | "departure" | "arrival";
type Sheet =
  | { kind: "station"; stop: StopRef }
  | { kind: "share"; from: string; to: string; journey: Journey };

/** How many steps lie between this screen and the start page. */
const depth = (): number => (history.state?.depth as number | undefined) ?? 0;

const SOURCES_URL = "https://transitous.org/sources/";
const OSM_URL = "https://www.openstreetmap.org/copyright";
const REPO_URL = "https://github.com/ElianDarou/nahfahrt";

/** Current local time in the format of a datetime-local input. */
function localInputValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function Field(props: { label: string; station?: Station; onClick: () => void }) {
  const { station } = props;
  return (
    <button type="button" class="field" onClick={props.onClick}>
      <span class="field-label">{props.label}</span>
      {station ? (
        <span class="field-value">{displayName(station)}</span>
      ) : (
        <span class="field-placeholder">Bahnhof, Haltestelle, Adresse</span>
      )}
    </button>
  );
}

export function App() {
  const [view, setView] = useState<View>("home");
  const [from, setFrom] = useState<Station>();
  const [to, setTo] = useState<Station>();
  const [whenMode, setWhenMode] = useState<WhenMode>("now");
  const [dateTime, setDateTime] = useState(localInputValue);
  const [activeSearch, setActiveSearch] = useState<{
    id: number;
    from: Station;
    to: Station;
    when: When;
  }>();
  const [, setRevision] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [liveKey, setLiveKey] = useState<string>();
  const [liveFromResults, setLiveFromResults] = useState(false);
  const [clock, setClock] = useState(() => Date.now() / 60000);
  const [sheet, setSheet] = useState<Sheet>();
  const [stationRevision, setStationRevision] = useState(0);
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keeps the status of saved connections current without any network use.
  useEffect(() => {
    if (view !== "home") return;
    setClock(Date.now() / 60000);
    const timer = setInterval(() => setClock(Date.now() / 60000), 30_000);
    return () => clearInterval(timer);
  }, [view]);

  // The Android back button walks through the browser history.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      setView((event.state?.view as View) ?? "home");
      if (!event.state?.sheet) setSheet(undefined);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const open = useCallback((next: View) => {
    history.pushState({ view: next, depth: depth() + 1 }, "");
    setView(next);
  }, []);
  const back = useCallback(() => history.back(), []);
  const goHome = useCallback(() => {
    if (depth()) history.go(-depth());
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 4000);
  }, []);

  // A sheet is a history step too, so the Android back button closes it first.
  const openSheet = (next: Sheet) => {
    history.pushState({ view, depth: depth() + 1, sheet: true }, "");
    setSheet(next);
  };
  const openStation = (stop: StopRef) => openSheet({ kind: "station", stop });
  const openShare = (start: string, destination: string, journey: Journey) =>
    openSheet({ kind: "share", from: start, to: destination, journey });

  const buildWhen = (mode: WhenMode): When => {
    const query = filtersToQuery(filters);
    const label = windowLabel(filters);
    if (hasTimeWindow(filters)) return { at: Date.now(), arriveBy: false, filters: query, label };
    return mode === "now"
      ? { arriveBy: false, filters: query }
      : { at: new Date(dateTime).getTime(), arriveBy: mode === "arrival", filters: query };
  };

  const openLive = (key: string, fromResults: boolean) => {
    setLiveKey(key);
    setLiveFromResults(fromResults);
    open("live");
  };

  // Reminders move along when the app comes back, and lead back to their connection.
  useEffect(() => {
    const sync = () => {
      if (!document.hidden) void syncAllReminders().catch(() => undefined);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    const stop = onReminderTap((key) => openLive(key, false));
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, []);

  const startSearch = (start: Station, destination: Station, when: When) => {
    setAdvancedOpen(false);
    const usedStart = recordStationUse(start);
    const usedDestination = recordStationUse(destination);
    recordRoute(usedStart, usedDestination);
    setFrom(usedStart);
    setTo(usedDestination);
    setActiveSearch({ id: Date.now(), from: usedStart, to: usedDestination, when });
    open("results");
  };

  const sheets = (
    <>
      {sheet?.kind === "station" && (
        <StationSheet
          stop={sheet.stop}
          onClose={back}
          onStart={(station) => {
            setFrom(station);
            showToast(`${displayName(station)} ist jetzt der Start`);
            goHome();
          }}
          onDestination={(station) => {
            setTo(station);
            showToast(`${displayName(station)} ist jetzt das Ziel`);
            goHome();
          }}
          onFavourite={(station, nowFavourite) => {
            setStationRevision((revision) => revision + 1);
            showToast(
              nowFavourite
                ? `${displayName(station)} ist jetzt ein Favorit`
                : `${displayName(station)} ist kein Favorit mehr`,
            );
            back();
          }}
        />
      )}
      {sheet?.kind === "share" && (
        <ShareSheet
          from={sheet.from}
          to={sheet.to}
          journey={sheet.journey}
          onClose={back}
          onDone={(message) => {
            if (message) showToast(message);
            back();
          }}
        />
      )}
      {toast && (
        <p class="toast" role="status">
          {toast}
        </p>
      )}
    </>
  );

  if (view === "pick-from" || view === "pick-to") {
    const isStart = view === "pick-from";
    return (
      <>
        <Picker
          title={isStart ? "Start wählen" : "Ziel wählen"}
          revision={stationRevision}
          onClose={back}
          onHold={openStation}
          onPick={(station) => {
            if (isStart) setFrom(station);
            else setTo(station);
            back();
          }}
        />
        {sheets}
      </>
    );
  }

  if (view === "pick-via") {
    return (
      <>
        <Picker
          title="Zwischenhalt wählen"
          stopsOnly
          revision={stationRevision}
          onClose={back}
          onHold={openStation}
          onPick={(station) => {
            setFilters({ ...filters, via: station });
            back();
          }}
        />
        {sheets}
      </>
    );
  }

  // Results stay mounted below the live view, so going back costs no new search.
  const showResults = view === "results" || (view === "live" && liveFromResults);
  if (view === "live" || (view === "results" && activeSearch)) {
    return (
      <>
        {activeSearch && showResults && (
          <div hidden={view === "live"} class="view">
            <Results
              key={activeSearch.id}
              from={activeSearch.from}
              to={activeSearch.to}
              when={activeSearch.when}
              visible={view === "results"}
              onBack={back}
              onFollow={(key) => openLive(key, true)}
              onShare={openShare}
              onStation={openStation}
            />
          </div>
        )}
        {view === "live" && liveKey && (
          <Live
            key={liveKey}
            savedKey={liveKey}
            onBack={back}
            onShare={openShare}
            onStation={openStation}
            onToast={showToast}
          />
        )}
        {sheets}
      </>
    );
  }

  const routes = topRoutes(5);
  const sameStation = !!from && !!to && from.key === to.key;
  const validTime = whenMode === "now" || !Number.isNaN(new Date(dateTime).getTime());
  const problem = filterProblem(filters);
  const saved = getSaved(clock);

  return (
    <div class="screen">
      <header class="bar">
        <h1 class="brand">Nahfahrt</h1>
      </header>
      <div class="scroll home">
        <section class="search-card" aria-label="Verbindung suchen">
          <div class="fields">
            <Field label="Start" station={from} onClick={() => open("pick-from")} />
            <Field label="Ziel" station={to} onClick={() => open("pick-to")} />
            <button
              type="button"
              class="swap"
              aria-label="Start und Ziel tauschen"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <SwapIcon />
            </button>
          </div>

          <div class="segments" role="radiogroup" aria-label="Zeitpunkt">
            {(
              [
                ["now", "Jetzt"],
                ["departure", "Abfahrt"],
                ["arrival", "Ankunft"],
              ] as const
            ).map(([mode, text]) => (
              <button
                type="button"
                role="radio"
                aria-checked={whenMode === mode}
                class={whenMode === mode ? "segment segment-on" : "segment"}
                key={mode}
                onClick={() => setWhenMode(mode)}
              >
                {text}
              </button>
            ))}
          </div>

          {whenMode !== "now" && (
            <input
              class="datetime"
              type="datetime-local"
              aria-label={whenMode === "arrival" ? "Ankunftszeit" : "Abfahrtszeit"}
              value={dateTime}
              onInput={(event) => setDateTime(event.currentTarget.value)}
            />
          )}

          <AdvancedSearch
            open={advancedOpen}
            onToggle={() => setAdvancedOpen(!advancedOpen)}
            filters={filters}
            onChange={setFilters}
            onPickVia={() => open("pick-via")}
          />

          <button
            type="button"
            class="primary"
            disabled={!from || !to || sameStation || !validTime || !!problem}
            onClick={() => from && to && startSearch(from, to, buildWhen(whenMode))}
          >
            Verbindungen suchen
          </button>
          {sameStation && <p class="note note-warn">Start und Ziel sind gleich.</p>}
          {problem && <p class="note note-warn">{problem}</p>}
        </section>

        {saved.length > 0 && (
          <section>
            <h2 class="home-heading">Gemerkte Verbindungen</h2>
            <ul class="routes">
              {saved.map((entry) => {
                const state = progressOf(entry.journey, entry.stops, clock);
                const legs = vehicles(entry.journey);
                const moving = state.phase !== "upcoming";
                return (
                  <li class="route" key={entry.key}>
                    <button type="button" class="route-main" onClick={() => openLive(entry.key, false)}>
                      <span class="route-title">
                        {entry.from} → {entry.to}
                      </span>
                      <span class="route-sub">
                        {formatDay(journeyStart(entry.journey))},{" "}
                        {formatTime(legs[0].a + (legs[0].x ?? 0))}–
                        {formatTime(legs[legs.length - 1].b + (legs[legs.length - 1].y ?? 0))}
                      </span>
                      <span class={moving ? "route-status route-status-live" : "route-status"}>
                        {state.headline}
                      </span>
                    </button>
                    {canRemind() && (
                      <button
                        type="button"
                        class="icon-button"
                        aria-label={entry.bell ? "Erinnerung ausschalten" : "Erinnerung einschalten"}
                        aria-pressed={!!entry.bell}
                        onClick={() => {
                          setBell(entry, !entry.bell)
                            .then((result) => showToast(result.text))
                            .catch(() => showToast("Die Erinnerung ließ sich nicht einrichten."))
                            .finally(() => setRevision((revision) => revision + 1));
                        }}
                      >
                        <BellIcon on={!!entry.bell} />
                      </button>
                    )}
                    <button
                      type="button"
                      class="icon-button"
                      aria-label="Nicht mehr merken"
                      onClick={() => {
                        forgetSaved(entry.key);
                        setRevision((revision) => revision + 1);
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {routes.length > 0 && (
          <section>
            <h2 class="home-heading">Deine Strecken</h2>
            <ul class="routes">
              {routes.map(({ route, from: start, to: destination }) => (
                <li class="route" key={`${route.from}-${route.to}`}>
                  <button
                    type="button"
                    class="route-main"
                    onClick={() => startSearch(start, destination, { arriveBy: false })}
                  >
                    <span class="route-title">
                      {displayName(start)} → {displayName(destination)}
                    </span>
                    <span class="route-sub">
                      {[displaySub(start), displaySub(destination)].filter(Boolean).join(" → ")}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label="Strecke entfernen"
                    onClick={() => {
                      removeRoute(route);
                      setRevision((revision) => revision + 1);
                    }}
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer class="legal">
          <p>Nur Nahverkehr: Bus, Tram, U-Bahn, S-Bahn, Regionalzug.</p>
          <p>
            Daten: <a href={SOURCES_URL}>Transitous und Quellen</a>, Karte und Wege ©{" "}
            <a href={OSM_URL}>OpenStreetMap-Mitwirkende</a>.
          </p>
          <p>
            <a href={REPO_URL}>Open Source auf GitHub</a>. Kein Angebot der Deutschen Bahn.
          </p>
        </footer>
      </div>
      {sheets}
    </div>
  );
}
