import { ALL_MODES, activeFilterCount, defaultFilters, hasTimeWindow, todayInput, type FilterState } from "./filters";
import { ChevronIcon, CloseIcon } from "./icons";
import { displayName } from "./store";

const SORTS = [
  ["", "Abfahrt"],
  ["fast", "Schnellste"],
  ["few", "Wenig Umstiege"],
] as const;

const MODE_LABELS: [string, string][] = [
  ["B", "Bus"],
  ["T", "Tram"],
  ["U", "U-Bahn"],
  ["S", "S-Bahn"],
  ["R", "Regionalzug"],
  ["F", "Fähre"],
];

function Choice(props: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label class="adv-field">
      <span class="adv-label">{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
        {props.options.map(([value, text]) => (
          <option value={value} key={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimeRange(props: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div class="adv-field">
      <span class="adv-label" id={`range-${props.label}`}>
        {props.label}
      </span>
      <div class="time-range" role="group" aria-labelledby={`range-${props.label}`}>
        <input
          type="time"
          aria-label={`${props.label} von`}
          value={props.from}
          onInput={(event) => props.onChange(event.currentTarget.value, props.to)}
        />
        <span>bis</span>
        <input
          type="time"
          aria-label={`${props.label} bis`}
          value={props.to}
          onInput={(event) => props.onChange(props.from, event.currentTarget.value)}
        />
        {(props.from || props.to) && (
          <button
            type="button"
            class="icon-button small"
            aria-label={`${props.label} löschen`}
            onClick={() => props.onChange("", "")}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}

export function AdvancedSearch(props: {
  open: boolean;
  onToggle: () => void;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onPickVia: () => void;
}) {
  const { filters, onChange } = props;
  const set = (change: Partial<FilterState>) => onChange({ ...filters, ...change });
  const count = activeFilterCount(filters);
  const windowStarted = !!(
    filters.departFrom ||
    filters.departTo ||
    filters.arriveFrom ||
    filters.arriveTo
  );

  const toggleMode = (code: string) => {
    const selected = filters.modes.includes(code)
      ? filters.modes.replace(code, "")
      : ALL_MODES.split("")
          .filter((mode) => mode === code || filters.modes.includes(mode))
          .join("");
    set({ modes: selected });
  };

  return (
    <div class="advanced">
      <button
        type="button"
        class="advanced-toggle"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <span>
          Erweiterte Suche
          {count > 0 && <span class="badge">{count}</span>}
        </span>
        <ChevronIcon open={props.open} />
      </button>

      {props.open && (
        <div class="advanced-panel">
          <div class="adv-field">
            <span class="adv-label">Reihenfolge</span>
            <div class="segments" role="radiogroup" aria-label="Reihenfolge">
              {SORTS.map(([value, text]) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={filters.sort === value}
                  class={filters.sort === value ? "segment segment-on" : "segment"}
                  key={value}
                  onClick={() => set({ sort: value })}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <TimeRange
            label="Abfahrt zwischen"
            from={filters.departFrom}
            to={filters.departTo}
            onChange={(departFrom, departTo) => set({ departFrom, departTo })}
          />
          <TimeRange
            label="Ankunft zwischen"
            from={filters.arriveFrom}
            to={filters.arriveTo}
            onChange={(arriveFrom, arriveTo) => set({ arriveFrom, arriveTo })}
          />
          {windowStarted && (
            <label class="adv-field">
              <span class="adv-label">Tag der Zeitfenster</span>
              <input
                type="date"
                value={filters.date || todayInput()}
                onInput={(event) => set({ date: event.currentTarget.value })}
              />
            </label>
          )}
          {hasTimeWindow(filters) && (
            <p class="note">Das Zeitfenster ersetzt den Zeitpunkt oben.</p>
          )}

          <div class="adv-grid">
            <Choice
              label="Max. Umstiege"
              value={filters.maxTransfers}
              options={[
                ["", "Beliebig"],
                ["0", "Nur direkt"],
                ["1", "1"],
                ["2", "2"],
                ["3", "3"],
              ]}
              onChange={(maxTransfers) => set({ maxTransfers })}
            />
            <Choice
              label="Max. Reisedauer"
              value={filters.maxTravel}
              options={[
                ["", "Beliebig"],
                ["30", "30 Min."],
                ["60", "1 Std."],
                ["120", "2 Std."],
                ["180", "3 Std."],
                ["240", "4 Std."],
                ["360", "6 Std."],
              ]}
              onChange={(maxTravel) => set({ maxTravel })}
            />
            <Choice
              label="Fußweg zu Start und Ziel"
              value={filters.maxWalk}
              options={[
                ["", "Automatisch"],
                ["5", "Max. 5 Min."],
                ["10", "Max. 10 Min."],
                ["15", "Max. 15 Min."],
                ["30", "Max. 30 Min."],
              ]}
              onChange={(maxWalk) => set({ maxWalk })}
            />
            <Choice
              label="Umstiegszeit"
              value={filters.extraTransfer}
              options={[
                ["", "Normal"],
                ["5", "5 Min. mehr"],
                ["10", "10 Min. mehr"],
                ["15", "15 Min. mehr"],
              ]}
              onChange={(extraTransfer) => set({ extraTransfer })}
            />
          </div>

          <div class="adv-field">
            <span class="adv-label">Verkehrsmittel</span>
            <div class="toggle-chips">
              {MODE_LABELS.map(([code, text]) => (
                <button
                  type="button"
                  class={filters.modes.includes(code) ? "toggle-chip toggle-chip-on" : "toggle-chip"}
                  aria-pressed={filters.modes.includes(code)}
                  key={code}
                  onClick={() => toggleMode(code)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div class="adv-field">
            <span class="adv-label">Über</span>
            <div class="via-row">
              <button type="button" class="via-button" onClick={props.onPickVia}>
                {filters.via ? displayName(filters.via) : "Haltestelle wählen"}
              </button>
              {filters.via && (
                <button
                  type="button"
                  class="icon-button small"
                  aria-label="Zwischenhalt entfernen"
                  onClick={() => set({ via: undefined, viaStay: "0" })}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          </div>
          {filters.via && (
            <Choice
              label="Aufenthalt"
              value={filters.viaStay}
              options={[
                ["0", "Nur durchfahren"],
                ["5", "5 Min."],
                ["15", "15 Min."],
                ["30", "30 Min."],
                ["60", "1 Std."],
                ["120", "2 Std."],
              ]}
              onChange={(viaStay) => set({ viaStay })}
            />
          )}

          <label class="adv-check">
            <input
              type="checkbox"
              checked={filters.stepFree}
              onChange={(event) => set({ stepFree: event.currentTarget.checked })}
            />
            <span>
              Stufenfreie Fußwege
              <small>Soweit bekannt. Sagt nichts über den Einstieg ins Fahrzeug.</small>
            </span>
          </label>

          {count > 0 && (
            <button type="button" class="text-button" onClick={() => onChange(defaultFilters())}>
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
