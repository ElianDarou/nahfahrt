import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText, nearbyStops, searchPlaces } from "./api";
import {
  AddressIcon,
  CloseIcon,
  LocationIcon,
  NearbyIcon,
  PencilIcon,
  StarIcon,
  StopIcon,
  TrashIcon,
} from "./icons";
import { currentPosition } from "./location";
import { useLongPress } from "./long-press";
import { distanceMetres, formatDistance } from "./position";
import { byUsage, matches } from "./rank";
import {
  LOCATION_STATION,
  clearHistory,
  displayName,
  displaySub,
  getStations,
  regionHint,
  removeFromHistory,
  renameStation,
  stationFromPlace,
  toggleFavourite,
  type Station,
} from "./store";
import type { StopRef } from "./stops";

const DEBOUNCE_MS = 250;
const MIN_REMOTE_CHARS = 2;
/** Results for this session, so that correcting a typo costs no data. */
const sessionResults = new Map<string, Station[]>();

function isSamePlace(left: Station, right: Station): boolean {
  if (left.key === right.key || (left.id && left.id === right.id)) return true;
  const metres = Math.hypot((left.lat - right.lat) * 111_000, (left.lon - right.lon) * 74_000);
  return metres < 100 && !left.addr === !right.addr;
}

function Row(props: {
  station: Station;
  /** Shown beside the place, such as how far away it is. */
  note?: string;
  onPick: () => void;
  onStar: () => void;
  onHold: () => void;
  onRename?: () => void;
  onRemove?: () => void;
}) {
  const { station } = props;
  const sub = [props.note, displaySub(station)].filter(Boolean).join(" · ");
  const press = useLongPress(props.onHold, props.onPick);
  return (
    <li class="row">
      <button type="button" class="row-main station-button" {...press}>
        <span class="row-icon">{station.addr ? <AddressIcon /> : <StopIcon />}</span>
        <span class="row-text">
          <span class="row-title">{displayName(station)}</span>
          {sub && <span class="row-sub">{sub}</span>}
        </span>
      </button>
      {props.onRename && (
        <button type="button" class="icon-button" aria-label="Umbenennen" onClick={props.onRename}>
          <PencilIcon />
        </button>
      )}
      {props.onRemove && (
        <button type="button" class="icon-button" aria-label="Aus dem Verlauf entfernen" onClick={props.onRemove}>
          <CloseIcon />
        </button>
      )}
      <button
        type="button"
        class="icon-button"
        aria-label={station.fav ? "Favorit entfernen" : "Als Favorit speichern"}
        aria-pressed={!!station.fav}
        onClick={props.onStar}
      >
        <StarIcon filled={!!station.fav} />
      </button>
    </li>
  );
}

export function Picker(props: {
  title: string;
  /** Only stops with an id can be travelled through. */
  stopsOnly?: boolean;
  onClose: () => void;
  onPick: (station: Station) => void;
  onHold: (stop: StopRef) => void;
  /** Changes when something else, such as the station menu, changed the stored stations. */
  revision: number;
}) {
  const usable = (station: Station) => !props.stopsOnly || (!station.addr && !!station.id);
  const [query, setQuery] = useState("");
  const [stations, setStations] = useState(getStations);
  const [remote, setRemote] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [nearby, setNearby] = useState<{ station: Station; metres: number }[]>();
  const [locating, setLocating] = useState(false);
  const [nearbyError, setNearbyError] = useState<string>();
  const [renaming, setRenaming] = useState<Station>();
  const [label, setLabel] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setStations(getStations()), [props.revision]);
  useEffect(() => {
    if (renaming) labelInput.current?.focus();
  }, [renaming]);

  useEffect(() => {
    const text = query.trim();
    setError(undefined);
    if (text.length < MIN_REMOTE_CHARS) {
      setRemote([]);
      setLoading(false);
      return;
    }
    const known = sessionResults.get(text.toLocaleLowerCase("de"));
    if (known) {
      setRemote(known);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(text, regionHint(), controller.signal)
        .then((places) => {
          const results = places.map(stationFromPlace);
          sessionResults.set(text.toLocaleLowerCase("de"), results);
          setRemote(results);
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) setError(errorText(failure));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const typing = query.trim().length > 0;
  const sorted = useMemo(() => byUsage(stations).filter(usable), [stations, props.stopsOnly]);
  const localMatches = useMemo(
    () => sorted.filter((station) => matches(query, station)),
    [sorted, query],
  );
  const favourites = sorted.filter((station) => station.fav);
  const history = sorted.filter((station) => !station.fav && station.count > 0);
  const others = remote.filter(
    (station) => usable(station) && !localMatches.some((local) => isSamePlace(local, station)),
  );

  const refresh = () => setStations(getStations());
  const hold = (station: Station) => props.onHold({ name: station.name, station });
  const findNearby = async () => {
    setLocating(true);
    setNearbyError(undefined);
    try {
      const fix = await currentPosition();
      const places = await nearbyStops(Number(fix.lat.toFixed(6)), Number(fix.lon.toFixed(6)));
      const found = places
        .map(stationFromPlace)
        .map((station) => ({ station, metres: distanceMetres(fix, station) }))
        .sort((left, right) => left.metres - right.metres);
      setNearby(found);
      if (!found.length) setNearbyError("Keine Haltestelle in der Nähe gefunden.");
    } catch (failure) {
      setNearbyError(errorText(failure));
    } finally {
      setLocating(false);
    }
  };
  const star = (station: Station) => {
    toggleFavourite(station);
    refresh();
  };
  const startRename = (station: Station) => {
    setLabel(station.label ?? "");
    setRenaming(station);
  };
  const saveRename = (event: Event) => {
    event.preventDefault();
    if (renaming) renameStation(renaming, label);
    setRenaming(undefined);
    refresh();
  };

  return (
    <div class="screen">
      <header class="bar">
        <button type="button" class="icon-button" aria-label="Schließen" onClick={props.onClose}>
          <CloseIcon />
        </button>
        <h1>{props.title}</h1>
      </header>
      <div class="search-field">
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Bahnhof, Haltestelle, Adresse"
          aria-label="Bahnhof, Haltestelle oder Adresse suchen"
          autocomplete="off"
          autocapitalize="words"
          enterkeyhint="search"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <div class="scroll">
        {!typing && (
          <ul class="list">
            {!props.stopsOnly && (
              <li class="row">
                <button
                  type="button"
                  class="row-main"
                  onClick={() => props.onPick(LOCATION_STATION)}
                >
                  <span class="row-icon row-icon-accent">
                    <LocationIcon />
                  </span>
                  <span class="row-text">
                    <span class="row-title">Mein Standort</span>
                    <span class="row-sub">Genau, wird nicht gespeichert</span>
                  </span>
                </button>
              </li>
            )}
            <li class="row">
              <button
                type="button"
                class="row-main"
                disabled={locating}
                onClick={() => void findNearby()}
              >
                <span class="row-icon row-icon-accent">
                  <NearbyIcon />
                </span>
                <span class="row-text">
                  <span class="row-title">Haltestellen in der Nähe</span>
                </span>
              </button>
              {locating && <span class="spinner row-spinner" role="status" aria-label="Sucht" />}
            </li>
            {nearby?.map(({ station, metres }) => (
              <Row
                key={`near-${station.key}`}
                station={station}
                note={formatDistance(metres)}
                onPick={() => props.onPick(station)}
                onHold={() => hold(station)}
                onStar={() => star(station)}
              />
            ))}
          </ul>
        )}
        {!typing && nearbyError && <p class="hint">{nearbyError}</p>}

        {!typing && favourites.length > 0 && (
          <ul class="list">
            {favourites.map((station) => (
              <Row
                key={station.key}
                station={station}
                onPick={() => props.onPick(station)}
                onHold={() => hold(station)}
                onStar={() => star(station)}
                onRename={() => startRename(station)}
              />
            ))}
          </ul>
        )}

        {!typing && history.length > 0 && (
          <>
            <div class="section-head">
              <h2>Verlauf</h2>
              <button
                type="button"
                class="icon-button"
                aria-label="Verlauf löschen"
                onClick={() => {
                  clearHistory();
                  refresh();
                }}
              >
                <TrashIcon />
              </button>
            </div>
            <ul class="list">
              {history.map((station) => (
                <Row
                  key={station.key}
                  station={station}
                  onPick={() => props.onPick(station)}
                  onHold={() => hold(station)}
                  onStar={() => star(station)}
                  onRemove={() => {
                    removeFromHistory(station);
                    refresh();
                  }}
                />
              ))}
            </ul>
          </>
        )}

        {!typing && !favourites.length && !history.length && (
          <p class="hint">
            Stationen, die du nutzt, erscheinen hier und beim Tippen sofort ganz oben. Lang
            drücken öffnet mehr Aktionen.
          </p>
        )}

        {typing && localMatches.length > 0 && (
          <ul class="list">
            {localMatches.map((station) => (
              <Row
                key={station.key}
                station={station}
                onPick={() => props.onPick(station)}
                onHold={() => hold(station)}
                onStar={() => star(station)}
                onRename={station.fav ? () => startRename(station) : undefined}
              />
            ))}
          </ul>
        )}

        {typing && (others.length > 0 || loading) && (
          <div class="section-head">
            <h2>Weitere Ergebnisse</h2>
            {loading && <span class="spinner" role="status" aria-label="Lädt" />}
          </div>
        )}
        {typing && others.length > 0 && (
          <ul class="list">
            {others.map((station) => (
              <Row
                key={station.key}
                station={station}
                onPick={() => props.onPick(station)}
                onHold={() => hold(station)}
                onStar={() => star(station)}
              />
            ))}
          </ul>
        )}
        {typing && error && <p class="hint">{error}</p>}
        {typing && !loading && !error && !localMatches.length && !others.length &&
          query.trim().length >= MIN_REMOTE_CHARS && <p class="hint">Nichts gefunden.</p>}
      </div>

      {renaming && (
        <div class="overlay">
          <form class="dialog" onSubmit={saveRename}>
            <h2>Favorit benennen</h2>
            <p class="dialog-sub">{renaming.name}</p>
            <input
              ref={labelInput}
              type="text"
              value={label}
              maxLength={30}
              placeholder="z. B. Arbeit"
              aria-label="Name des Favoriten"
              onInput={(event) => setLabel(event.currentTarget.value)}
            />
            <div class="dialog-actions">
              <button type="button" class="text-button" onClick={() => setRenaming(undefined)}>
                Abbrechen
              </button>
              <button type="submit" class="primary small">
                Speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
