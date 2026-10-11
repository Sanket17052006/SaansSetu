const ROUTING_BASE = (import.meta.env.VITE_ROUTING_API_BASE || "https://router.project-osrm.org").replace(/\/$/, "");
const PROFILE = import.meta.env.VITE_ROUTING_PROFILE || "driving";

export function distance(a, b) {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const arc = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function toRoute(candidate, index) {
  const coordinates = candidate.geometry.coordinates;
  const points = coordinates.map(([lng, lat]) => ({ lng, lat }));
  const distanceKm = candidate.distance / 1000;
  return {
    id: `route-${index}`,
    points,
    pathLength: distanceKm,
    minutes: Math.max(1, Math.round(candidate.duration / 60)),
    distanceKm: +distanceKm.toFixed(1),
    coordinates,
    durationSeconds: candidate.duration,
  };
}

function waypointPair(origin, destination) {
  const midLat = (origin.lat + destination.lat) / 2;
  const dx = (destination.lng - origin.lng) * Math.cos(midLat * Math.PI / 180) * 111.32;
  const dy = (destination.lat - origin.lat) * 111.32;
  const length = Math.max(0.1, Math.hypot(dx, dy));
  const offsetKm = Math.min(2, Math.max(0.6, length * 0.12));
  return [-1, 1].map((side) => ({
    lng: (origin.lng + destination.lng) / 2 - (dy / length) * side * offsetKm / (111.32 * Math.cos(midLat * Math.PI / 180)),
    lat: (origin.lat + destination.lat) / 2 + (dx / length) * side * offsetKm / 111.32,
  }));
}

async function requestRoutes(points, signal) {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = new URL(`${ROUTING_BASE}/route/v1/${PROFILE}/${coordinates}`);
  url.search = new URLSearchParams({ alternatives: "3", steps: "false", geometries: "geojson", overview: "full", annotations: "false" }).toString();
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Routing service returned ${response.status}.`);
  const result = await response.json();
  if (result.code !== "Ok" || !Array.isArray(result.routes)) return [];
  return result.routes;
}

/** Fetch road-following routes from an OSRM-compatible provider, including routes through nearby waypoints. */
export async function getRouteSet(origin, destination, reports, maxDetour, signal) {
  const [direct, ...detours] = await Promise.all([
    requestRoutes([origin, destination], signal),
    ...waypointPair(origin, destination).map((waypoint) => requestRoutes([origin, waypoint, destination], signal).catch((error) => {
      if (error.name === "AbortError") throw error;
      return [];
    })),
  ]);
  if (!direct.length) throw new Error("No drivable routes were found between these places.");
  const unique = new Map();
  [...direct, ...detours.flat()].forEach((route) => {
    const key = route.geometry.coordinates.filter((_, index) => index % Math.max(1, Math.floor(route.geometry.coordinates.length / 10)) === 0).map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`).join("|");
    if (!unique.has(key)) unique.set(key, route);
  });
  const candidates = [...unique.values()].map(toRoute).sort((a, b) => a.durationSeconds - b.durationSeconds);
  const fastest = candidates[0];
  return { fastest, best: fastest, reduction: 0, origin, destination, candidates, reports, provider: new URL(ROUTING_BASE).host };
}
