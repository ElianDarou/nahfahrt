import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { errorText } from "./api";
import { AddressIcon, StarIcon, StartIcon } from "./icons";
import { useLongPress } from "./long-press";
import { displayName, getStations, toggleFavourite, type Station } from "./store";
import { resolveStop, type StopRef } from "./stops";

/** A stop's name that opens its actions on a tap or when held. */
export function StationButton(props: {
  stop: StopRef;
  class?: string;
  onOpen: (stop: StopRef) => void;
  children: ComponentChildren;
}) {
  const open = () => props.onOpen(props.stop);
  const press = useLongPress(open, open);
  return (
    <button
      type="button"
      class={`station-button ${props.class ?? ""}`}
      aria-haspopup="dialog"
      {...press}
    >
      {props.children}
    </button>
  );
}

export function StationSheet(props: {
  stop: StopRef;
  onClose: () => void;
  onStart: (station: Station) => void;
  onDestination: (station: Station) => void;
  onFavourite: (station: Station, nowFavourite: boolean) => void;
}) {
  const [station, setStation] = useState<Station>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    resolveStop(props.stop, controller.signal)
      .then(setStation)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorText(failure));
      });
    return () => controller.abort();
  }, [props.stop]);

  const favourite = !!station && !!getStations().find((known) => known.key === station.key)?.fav;
  const title = station ? displayName(station) : props.stop.name;

  return (
    <div
      class="overlay overlay-bottom"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 class="sheet-title">{title}</h2>
        {station?.sub && !station.label && <p class="sheet-sub">{station.sub}</p>}
        {error && <p class="note note-bad">{error}</p>}
        {!station && !error && (
          <p class="sheet-sub">
            <span class="spinner spinner-small" role="status" aria-label="Lädt" /> Haltestelle wird
            gesucht
          </p>
        )}
        <div class="sheet-actions">
          <button
            type="button"
            class="sheet-action"
            disabled={!station}
            onClick={() => station && props.onStart(station)}
          >
            <StartIcon /> Als Start nehmen
          </button>
          <button
            type="button"
            class="sheet-action"
            disabled={!station}
            onClick={() => station && props.onDestination(station)}
          >
            <AddressIcon /> Als Ziel nehmen
          </button>
          <button
            type="button"
            class="sheet-action"
            disabled={!station}
            onClick={() => {
              if (!station) return;
              props.onFavourite(toggleFavourite(station), !favourite);
            }}
          >
            <StarIcon filled={favourite} />
            {favourite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
          </button>
        </div>
        <button type="button" class="text-button sheet-close" onClick={props.onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
