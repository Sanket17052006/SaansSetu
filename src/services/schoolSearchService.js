const PHOTON_URL = "https://photon.komoot.io/api/";
const INDIA_BOUNDS = { south: 6.4, north: 35.8, west: 68.0, east: 97.6 };

export async function searchSchools(query, signal) {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const url = new URL(PHOTON_URL);
  url.search = new URLSearchParams({ q: normalized, limit: "8", lang: "en", osm_tag: "amenity:school" }).toString();
  const response = await fetch(url, { signal, headers: { Accept: "application/geo+json" } });
  if (!response.ok) throw new Error("School search is temporarily unavailable.");
  const payload = await response.json();
  return (payload.features || []).flatMap((feature) => {
    const properties = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !properties.name || lat < INDIA_BOUNDS.south || lat > INDIA_BOUNDS.north || lon < INDIA_BOUNDS.west || lon > INDIA_BOUNDS.east) return [];
    if (properties.country && !/^(india|republic of india)$/i.test(properties.country.trim())) return [];
    return [{
      id: `osm-${properties.osm_type}-${properties.osm_id}`,
      name: properties.name,
      city: properties.city || properties.district || properties.county || "",
      state: properties.state || "",
      lat,
      lon,
      source: "OpenStreetMap",
      verified: false,
    }];
  });
}
