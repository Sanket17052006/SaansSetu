const AIR_QUALITY_URL = import.meta.env.VITE_AIR_QUALITY_API_URL || "https://air-quality-api.open-meteo.com/v1/air-quality";
const cache = new Map();
const CACHE_MS = 15 * 60_000;

function selectSamplePoints(points, count = 5) {
  if (points.length <= count) return points;
  return Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / (count - 1))]);
}

async function getPointForecast(point, signal) {
  const key = `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.value;
  const url = new URL(AIR_QUALITY_URL);
  url.search = new URLSearchParams({ latitude: point.lat.toFixed(4), longitude: point.lng.toFixed(4), hourly: "pm2_5,us_aqi", forecast_days: "2", timezone: "auto" }).toString();
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Air-quality service returned ${response.status}.`);
  const data = await response.json();
  const value = { times: data.hourly?.time ?? [], pm25: data.hourly?.pm2_5 ?? [], aqi: data.hourly?.us_aqi ?? [], model: "CAMS air-quality model" };
  if (!value.times.length || !value.pm25.some(Number.isFinite)) throw new Error("Air-quality service returned no hourly PM2.5 forecast.");
  cache.set(key, { savedAt: Date.now(), value });
  return value;
}

/** Compare forecasted route-average PM2.5 at evenly spaced points along each road route. */
export async function scoreRoutes(routeSet, maxDetour, signal) {
  const routeCandidates = [...new Map(routeSet.candidates.map((route) => [route.id, route])).values()];
  const scored = await Promise.all(routeCandidates.map(async (route) => {
    const samples = selectSamplePoints(route.points);
    const forecasts = await Promise.all(samples.map((point) => getPointForecast(point, signal)));
    const times = forecasts[0].times;
    const hourlyPm25 = times.map((_, index) => forecasts.reduce((sum, item) => sum + (item.pm25[index] ?? 0), 0) / forecasts.length);
    let currentIndex = times.findIndex((time) => new Date(time).getTime() >= Date.now());
    if (currentIndex < 0) currentIndex = times.length - 1;
    return {
      ...route,
      pm25: +hourlyPm25[currentIndex].toFixed(1),
      hourlyPm25,
      forecastTimes: times,
      aqi: Math.round(forecasts.reduce((sum, item) => sum + (item.aqi[currentIndex] ?? 0), 0) / forecasts.length),
      validAt: times[currentIndex],
      model: forecasts[0].model,
      airSamples: samples.map((point, index) => ({ ...point, pm25: forecasts[index].pm25[currentIndex] })),
    };
  }));
  const fastest = scored.reduce((best, route) => route.durationSeconds < best.durationSeconds ? route : best, scored[0]);
  const acceptable = scored.filter((route) => route.durationSeconds <= fastest.durationSeconds * (1 + maxDetour / 100));
  const best = acceptable.reduce((choice, route) => route.pm25 < choice.pm25 ? route : choice, fastest);
  const reduction = fastest.pm25 > 0 ? Math.max(0, Math.round((fastest.pm25 - best.pm25) / fastest.pm25 * 100)) : 0;
  const nextHours = best.forecastTimes.map((time, index) => ({ time, index })).filter(({ time }) => new Date(time).getTime() >= Date.now()).slice(0, 7);
  const departureWindow = nextHours.flatMap(({ time, index }) => acceptable.map((route) => ({ time, index, route, pm25: route.hourlyPm25[index] }))).reduce((choice, candidate) => candidate.pm25 < choice.pm25 ? candidate : choice, { pm25: best.pm25, route: best, time: best.validAt, index: best.forecastTimes.indexOf(best.validAt) });
  const currentAverage = acceptable.reduce((sum, route) => sum + route.pm25, 0) / acceptable.length;
  const waitReduction = currentAverage > 0 ? Math.max(0, Math.round((currentAverage - departureWindow.pm25) / currentAverage * 100)) : 0;
  return { ...routeSet, candidates: scored, fastest, best, reduction, departureWindow: { ...departureWindow, improvement: waitReduction }, airQuality: { model: best.model, validAt: best.validAt } };
}
