import { useEffect, useId, useState } from "react";
import { LoaderCircle, LocateFixed, MapPin, Search } from "lucide-react";
import { searchLocalPlaces, searchPlaces } from "../services/geocodingService.js";

export default function LocationSearch({ label, value, onChange, onUseLocation }) {
  const listId = useId();
  const [query, setQuery] = useState(value.name);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => { setQuery(value.name); }, [value.id, value.name]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || normalized.length < 2 || normalized === value.name) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return undefined;
    }
    const controller = new AbortController();
    setResults(searchLocalPlaces(normalized));
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      searchPlaces(normalized, controller.signal)
        .then((places) => { setResults(places); setActiveIndex(-1); })
        .catch((cause) => { if (cause.name !== "AbortError") setError("Place search is temporarily unavailable."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 240);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, open, value.name]);

  function choose(place) {
    onChange(place);
    setQuery(place.name);
    setOpen(false);
    setResults([]);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); }
    if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setActiveIndex((index) => (index + 1) % results.length); }
    if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1)); }
    if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]); }
  }

  return (
    <div className="location-search">
      <div className="location-entry">
      <label className="location-row">
        <span className="location-marker start-marker"><MapPin size={13} /></span>
        <span className="field-copy">
          <small>{label}</small>
          <span className="location-input-wrap">
            <input
              role="combobox"
              aria-label={label}
              aria-autocomplete="list"
              aria-expanded={open && query.trim().length >= 2}
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              value={query}
              placeholder="Type a place or landmark"
              onFocus={() => setOpen(true)}
              onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
              onKeyDown={handleKeyDown}
              onBlur={() => window.setTimeout(() => setOpen(false), 160)}
            />
            {loading ? <LoaderCircle size={15} className="search-spinner" /> : <Search size={15} />}
          </span>
        </span>
      </label>
      {onUseLocation && <button type="button" className="use-location-button" aria-label="Use my current location" title="Use my current location" onMouseDown={(event) => event.preventDefault()} onClick={onUseLocation}><LocateFixed size={16} /></button>}
      </div>
      {open && query.trim().length >= 2 && <div className="location-results" id={listId} role="listbox" aria-label={`${label} suggestions`}>
        {error ? <div className="location-result-message" role="status">{error}</div> : results.length ? results.map((place, index) => <button type="button" role="option" aria-selected={index === activeIndex} id={`${listId}-${index}`} className={`location-result ${index === activeIndex ? "location-result-active" : ""}`} key={place.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place)}><MapPin size={15} /><span>{place.name}</span><small>Use</small></button>) : loading ? <div className="location-result-message">Finding nearby places…</div> : <div className="location-result-message">No nearby matches. Try a street, landmark, or neighbourhood.</div>}
        <div className="location-attribution">Place data © OpenStreetMap contributors</div>
      </div>}
    </div>
  );
}
