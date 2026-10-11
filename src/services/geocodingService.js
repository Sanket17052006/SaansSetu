import { places as knownPlaces } from "../data.js";

const GEOCODING_BASE = (import.meta.env.VITE_GEOCODING_API_BASE || "https://photon.komoot.io").replace(/\/$/, "");
const DHANBAD_CENTER = { lat: 23.795, lng: 86.43 };

function normalize(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchLocalPlaces(query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return knownPlaces
    .map((place) => ({ ...place, match: normalize(place.name) }))
    .filter((place) => terms.every((term) => place.match.includes(term)))
    .sort((a, b) => a.match.indexOf(terms[0]) - b.match.indexOf(terms[0]))
    .map(({ match, ...place }) => place);
}

function distanceKm(a, b) {
  const latitudeScale = 111.32;
  const longitudeScale = latitudeScale * Math.cos((a.lat + b.lat) * Math.PI / 360);
  return Math.hypot((a.lat - b.lat) * latitudeScale, (a.lng - b.lng) * longitudeScale);
}

export async function searchPlaces(query, signal) {
  const localMatches = searchLocalPlaces(query);
  const url = new URL(`${GEOCODING_BASE}/api/`);
  url.search = new URLSearchParams({ q: query, lat: String(DHANBAD_CENTER.lat), lon: String(DHANBAD_CENTER.lng), limit: "8", lang: "en" }).toString();
  try {
    const response = await fetch(url, { signal, headers: { Accept: "application/geo+json, application/json" } });
    if (!response.ok) throw new Error(`Place search returned ${response.status}.`);
    const result = await response.json();
    const remoteMatches = (result.features ?? []).map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const properties = feature.properties ?? {};
      const name = [properties.name, properties.street, properties.city, properties.state].filter((value, index, list) => value && list.indexOf(value) === index).join(", ");
      return { id: `${properties.osm_type ?? "place"}-${properties.osm_id ?? `${lat}-${lng}`}`, name, lng, lat };
    }).filter((place) => place.name && distanceKm(place, DHANBAD_CENTER) <= 45);
    const seen = new Set(localMatches.map((place) => normalize(place.name)));
    return [...localMatches, ...remoteMatches.filter((place) => {
      const key = normalize(place.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })];
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (localMatches.length) return localMatches;
    throw error;
  }
}
