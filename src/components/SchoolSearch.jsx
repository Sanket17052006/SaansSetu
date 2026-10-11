import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MapPin, Search, X } from "lucide-react";
import { searchSchools } from "../services/schoolSearchService.js";

export default function SchoolSearch({ value, schools, onSelect }) {
  const [query, setQuery] = useState(value?.name || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const root = useRef(null);

  useEffect(() => { setQuery(value?.name || ""); }, [value?.id, value?.name]);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed === value?.name) { setResults([]); setLoading(false); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      searchSchools(trimmed, controller.signal)
        .then((items) => { setResults(items); setError(""); })
        .catch((reason) => { if (reason.name !== "AbortError") { setResults([]); setError("Could not reach the school directory. Try again in a moment."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, value?.name]);
  useEffect(() => {
    function close(event) { if (!root.current?.contains(event.target)) setOpen(false); }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const local = schools.filter((school) => `${school.name} ${school.city} ${school.state}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 4);
  const localIds = new Set(local.map((school) => school.id));
  const matches = [...local.map((school) => ({ ...school, source: "Sample school", verified: false })), ...results.filter((item) => !localIds.has(item.id))].slice(0, 8);
  function choose(school) { setQuery(school.name); setOpen(false); onSelect(school); }

  return <div className="school-searchbox" ref={root}>
    <label className="school-search-label" htmlFor="school-search">SCHOOL OR CITY</label>
    <div className={`school-search-input ${open ? "school-search-focus" : ""}`}>
      <Search size={15} aria-hidden="true" />
      <input id="school-search" role="combobox" aria-autocomplete="list" aria-expanded={open && matches.length > 0} aria-controls="school-search-results" value={query} placeholder="Search schools across India" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && matches[0]) { event.preventDefault(); choose(matches[0]); } }} />
      {loading ? <LoaderCircle className="school-search-spinner" size={15} /> : query && <button type="button" onClick={() => { setQuery(""); setResults([]); setOpen(true); }} aria-label="Clear school search"><X size={14} /></button>}
    </div>
    {open && query.trim().length >= 2 && <div className="school-search-results" id="school-search-results" role="listbox">
      {matches.map((school) => <button key={school.id} type="button" role="option" aria-selected={value?.id === school.id} onClick={() => choose(school)}><MapPin size={14} /><span><b>{school.name}</b><small>{[school.city, school.state].filter(Boolean).join(", ") || "Location listed in OpenStreetMap"}</small></span><em>{school.source === "Sample school" ? "SAMPLE" : school.verified ? "IN DIRECTORY" : "OSM LISTING"}</em></button>)}
      {!matches.length && !loading && <p>{error || "No school listing found. Try a school name or nearby city."}</p>}
      <footer>Listings from OpenStreetMap may be incomplete. Verify the school location before using it for decisions.</footer>
    </div>}
  </div>;
}
