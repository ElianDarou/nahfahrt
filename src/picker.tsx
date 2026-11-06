import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText, searchPlaces } from "./api";
import { AddressIcon, CloseIcon, PencilIcon, StarIcon, StopIcon, TrashIcon } from "./icons";
import { byUsage, matches } from "./rank";
import {
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
  onPick: () => void;
  onStar: () => void;
  onRename?: () => void;
  onRemove?: () => void;
}) {
  const { station } = props;
  const sub = displaySub(station);
  return (
    <li class="row">
      <button type="button" class="row-main" onClick={props.onPick}>
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
  onClose: () => void;
  onPick: (station: Station) => void;
}) {
  const [query, setQuery] = useState("");
  const [stations, setStations] = useState(getStations);
  const [remote, setRemote] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [renaming, setRenaming] = useState<Station>();
  const [label, setLabel] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
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
  const sorted = useMemo(() => byUsage(stations), [stations]);
  const localMatches = useMemo(
    () => sorted.filter((station) => matches(query, station)),
    [sorted, query],
  );
  const favourites = sorted.filter((station) => station.fav);
  const history = sorted.filter((station) => !station.fav && station.count > 0);
  const others = remote.filter(
    (station) => !localMatches.some((local) => isSamePlace(local, station)),
  );

  const refresh = () => setStations(getStations());
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
        {!typing && favourites.length > 0 && (
          <ul class="list">
            {favourites.map((station) => (
              <Row
                key={station.key}
                station={station}
                onPick={() => props.onPick(station)}
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
            Stationen, die du nutzt, erscheinen hier und beim Tippen sofort ganz oben.
          </p>
        )}

        {typing && localMatches.length > 0 && (
          <ul class="list">
            {localMatches.map((station) => (
              <Row
                key={station.key}
                station={station}
                onPick={() => props.onPick(station)}
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
