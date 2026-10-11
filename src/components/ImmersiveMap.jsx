import { useEffect, useRef, useState } from "react";
import { AttributionControl, LngLatBounds, Map, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Crosshair, Play, Rotate3D, RotateCcw, RotateCw, Satellite, Square, Sun, Trees } from "lucide-react";

const IMAGERY_SOURCE = import.meta.env.VITE_MAP_IMAGERY_TILES || "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const PLACE_LABEL_SOURCE = import.meta.env.VITE_MAP_LABEL_TILES || "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TERRAIN_SOURCE = import.meta.env.VITE_MAP_TERRAIN_TILES || "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
setWorkerUrl(workerUrl);

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

function pointFeature(item, properties = {}) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [item.lng, item.lat] }, properties: { ...properties, ...item } };
}

function lineFeature(route) {
  return { type: "Feature", geometry: { type: "LineString", coordinates: route.coordinates }, properties: {} };
}

function fitRouteBounds(map, routeSet) {
  const coords = [...routeSet.fastest.coordinates, ...routeSet.best.coordinates];
  if (coords.length < 2) return;
  const bounds = coords.reduce((result, coord) => result.extend(coord), new LngLatBounds(coords[0], coords[0]));
  map.fitBounds(bounds, { padding: { top: 105, right: 120, bottom: 90, left: 95 }, duration: 700, maxZoom: 13.4, pitch: map.getPitch(), bearing: map.getBearing() });
}

function fitLocationBounds(map, origin, destination) {
  const coords = [[origin.lng, origin.lat], [destination.lng, destination.lat]];
  const bounds = coords.reduce((result, coord) => result.extend(coord), new LngLatBounds(coords[0], coords[0]));
  map.fitBounds(bounds, { padding: { top: 105, right: 120, bottom: 90, left: 95 }, duration: 650, maxZoom: 13.4, pitch: map.getPitch(), bearing: map.getBearing() });
}

export default function ImmersiveMap({ routeSet, selectedRoute, reports, activeRoute, origin, destination }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tourTimerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [view3d, setView3d] = useState(true);
  const [look, setLook] = useState("natural");
  const [cameraIndex, setCameraIndex] = useState(0);
  const [mapError, setMapError] = useState("");
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    const map = new Map({
      container: containerRef.current,
      center: [86.431, 23.777],
      zoom: 11.6,
      pitch: 56,
      bearing: -24,
      maxPitch: 75,
      minZoom: 9,
      maxZoom: 17,
      attributionControl: false,
      antialias: true,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: "raster",
            tiles: [IMAGERY_SOURCE],
            tileSize: 256,
            maxzoom: 19,
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          },
          placeLabels: {
            type: "raster",
            tiles: [PLACE_LABEL_SOURCE],
            tileSize: 256,
            maxzoom: 19,
            attribution: "Place labels © Esri",
          },
          terrain: {
            type: "raster-dem",
            tiles: [TERRAIN_SOURCE],
            tileSize: 256,
            encoding: "terrarium",
            maxzoom: 15,
            attribution: "Elevation © Tilezen / AWS Open Data Registry",
          },
        },
        layers: [
          { id: "satellite-imagery", type: "raster", source: "imagery", paint: { "raster-fade-duration": 200 } },
          { id: "place-labels", type: "raster", source: "placeLabels", paint: { "raster-opacity": 0.83, "raster-fade-duration": 200 } },
        ],
        terrain: { source: "terrain", exaggeration: 1.45 },
        sky: { "atmosphere-blend": 0.2 },
      },
    });
    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.on("error", (event) => {
      if (event?.error) setMapError(event.error.message || "A map tile could not be loaded.");
    });
    map.on("load", () => {
      map.addSource("fastest-route", { type: "geojson", data: featureCollection([]) });
      map.addSource("cleaner-route", { type: "geojson", data: featureCollection([]) });
      map.addSource("community-reports", { type: "geojson", data: featureCollection([]) });
      map.addSource("air-samples", { type: "geojson", data: featureCollection([]) });
      map.addSource("trip-endpoints", { type: "geojson", data: featureCollection([]) });
      map.addLayer({ id: "fastest-route-shadow", type: "line", source: "fastest-route", paint: { "line-color": "#102b20", "line-width": 9, "line-opacity": 0.24, "line-blur": 1.5 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "fastest-route-line", type: "line", source: "fastest-route", paint: { "line-color": "#e2e8dc", "line-width": 4, "line-opacity": 0.87, "line-dasharray": [2.2, 1.6] }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "cleaner-route-shadow", type: "line", source: "cleaner-route", paint: { "line-color": "#092d1d", "line-width": 13, "line-opacity": 0.35, "line-blur": 1.2 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "cleaner-route-line", type: "line", source: "cleaner-route", paint: { "line-color": "#54eca5", "line-width": 6, "line-opacity": 0.97 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "air-sample-points", type: "circle", source: "air-samples", paint: { "circle-radius": 5, "circle-color": "#63d9ac", "circle-stroke-color": "#f7fff9", "circle-stroke-width": 2 } });
      map.addLayer({ id: "report-halo", type: "circle", source: "community-reports", paint: { "circle-radius": 19, "circle-color": "#ffb347", "circle-opacity": 0.32, "circle-blur": 0.2 } });
      map.addLayer({ id: "report-dot", type: "circle", source: "community-reports", paint: { "circle-radius": 8, "circle-color": "#f08f34", "circle-stroke-color": "#fff9ed", "circle-stroke-width": 2 } });
      map.addLayer({ id: "endpoint-ring", type: "circle", source: "trip-endpoints", paint: { "circle-radius": 10, "circle-color": ["match", ["get", "role"], "start", "#fffefa", "#df795d"], "circle-stroke-color": ["match", ["get", "role"], "start", "#49d79a", "#fff8e9"], "circle-stroke-width": 4 } });
      map.setTerrain({ source: "terrain", exaggeration: 1.45 });
      setReady(true);
    });

    return () => {
      window.clearTimeout(tourTimerRef.current);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const endpointSource = map.getSource("trip-endpoints");
    endpointSource?.setData(featureCollection([
      pointFeature(origin, { role: "start", label: "START" }),
      pointFeature(destination, { role: "end", label: "DESTINATION" }),
    ]));
    fitLocationBounds(map, origin, destination);
  }, [ready, origin, destination]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const fastestSource = map.getSource("fastest-route");
    const cleanerSource = map.getSource("cleaner-route");
    const reportSource = map.getSource("community-reports");
    const sampleSource = map.getSource("air-samples");
    const routeMatchesLocations = routeSet?.origin.id === origin.id && routeSet?.destination.id === destination.id;
    if (!routeMatchesLocations) {
      fastestSource?.setData(featureCollection([]));
      cleanerSource?.setData(featureCollection([]));
      sampleSource?.setData(featureCollection([]));
      reportSource?.setData(featureCollection(reports.map((item) => pointFeature(item, { label: `${item.type} · reviewed` }))));
      return;
    }
    fastestSource?.setData(featureCollection([lineFeature(routeSet.fastest)]));
    cleanerSource?.setData(featureCollection([lineFeature(routeSet.best)]));
    reportSource?.setData(featureCollection(reports.map((item) => pointFeature(item, { label: `${item.type} · reviewed` }))));
    sampleSource?.setData(featureCollection((selectedRoute?.airSamples ?? []).map((item) => pointFeature(item, { label: `${item.pm25} µg/m³ PM2.5` }))));
    map.setPaintProperty("fastest-route-line", "line-opacity", activeRoute === "fastest" ? 1 : 0.72);
    map.setPaintProperty("fastest-route-line", "line-width", activeRoute === "fastest" ? 5 : 3.5);
    map.setPaintProperty("cleaner-route-line", "line-opacity", activeRoute === "cleaner" ? 1 : 0.58);
    map.setPaintProperty("cleaner-route-line", "line-width", activeRoute === "cleaner" ? 7 : 4.5);
    fitRouteBounds(map, routeSet);
  }, [ready, routeSet, selectedRoute, reports, activeRoute, origin, destination]);

  function toggleRouteTour() {
    const map = mapRef.current;
    const coordinates = selectedRoute?.coordinates ?? [];
    if (!map || coordinates.length < 2) return;
    if (tourTimerRef.current) {
      window.clearTimeout(tourTimerRef.current);
      tourTimerRef.current = null;
      setTourActive(false);
      return;
    }
    setTourActive(true);
    let step = 0;
    const stops = Math.min(7, coordinates.length - 1);
    const move = () => {
      step += 1;
      if (step > stops) {
        tourTimerRef.current = null;
        setTourActive(false);
        return;
      }
      const index = Math.round(step * (coordinates.length - 1) / stops);
      const before = coordinates[Math.max(0, index - 1)];
      const point = coordinates[index];
      const after = coordinates[Math.min(coordinates.length - 1, index + 1)];
      const bearing = Math.atan2(after[0] - before[0], after[1] - before[1]) * 180 / Math.PI;
      map.easeTo({ center: point, zoom: 14.8, pitch: 66, bearing, duration: 1450 });
      tourTimerRef.current = window.setTimeout(move, 1650);
    };
    map.flyTo({ center: coordinates[0], zoom: 14.8, pitch: 66, speed: 0.8, curve: 1.3 });
    tourTimerRef.current = window.setTimeout(move, 1400);
  }

  function changeLook(nextLook) {
    setLook(nextLook);
    const map = mapRef.current;
    if (!map?.getLayer("satellite-imagery")) return;
    const presets = {
      natural: { "raster-saturation": -0.08, "raster-contrast": 0.1, "raster-brightness-min": 0.05, "raster-brightness-max": 0.92, "raster-hue-rotate": 0 },
      moss: { "raster-saturation": -0.24, "raster-contrast": 0.18, "raster-brightness-min": 0.06, "raster-brightness-max": 0.86, "raster-hue-rotate": 12 },
      amber: { "raster-saturation": -0.12, "raster-contrast": 0.24, "raster-brightness-min": 0.08, "raster-brightness-max": 0.89, "raster-hue-rotate": -9 },
    };
    Object.entries(presets[nextLook]).forEach(([property, value]) => map.setPaintProperty("satellite-imagery", property, value));
  }

  function rotateCamera(direction) {
    const map = mapRef.current;
    if (!map) return;
    const bearing = map.getBearing() + direction * 45;
    map.easeTo({ bearing, pitch: view3d ? 56 : 0, duration: 650 });
    setCameraIndex((index) => index + direction);
  }

  function toggle3d() {
    const next = !view3d;
    setView3d(next);
    mapRef.current?.easeTo({ pitch: next ? 56 : 0, duration: 700 });
  }

  function resetCamera() {
    setView3d(true);
    setCameraIndex(0);
    mapRef.current?.easeTo({ bearing: -24, pitch: 56, duration: 700 });
  }

  return (
    <div className="map-canvas immersive-map">
      <div className="map-render" ref={containerRef} />
      <div className="map-vignette" />
      {mapError && <div className="map-status"><Satellite size={15} /> {mapError}</div>}
      <div className="map-look-switcher" aria-label="Satellite map appearance">
        <button className={look === "natural" ? "look-active" : ""} onClick={() => changeLook("natural")}><Satellite size={13} /> Natural</button>
        <button className={look === "moss" ? "look-active" : ""} onClick={() => changeLook("moss")}><Trees size={13} /> Moss</button>
        <button className={look === "amber" ? "look-active" : ""} onClick={() => changeLook("amber")}><Sun size={13} /> Warm</button>
      </div>
      <div className="camera-tools">
        <button className={`camera-button camera-tour ${tourActive ? "camera-active" : ""}`} onClick={toggleRouteTour} disabled={!selectedRoute} aria-label={tourActive ? "Stop route flyover" : "Fly over this route"}>{tourActive ? <Square size={14} /> : <Play size={14} fill="currentColor" />} <span>{tourActive ? "Stop" : "Fly"}</span></button>
        <button className={`camera-button ${view3d ? "camera-active" : ""}`} onClick={toggle3d}><Rotate3D size={15} /> <span>{view3d ? "3D" : "Flat"}</span></button>
        <button className="camera-button camera-rotate" onClick={() => rotateCamera(-1)} aria-label="Rotate map left"><RotateCcw size={15} /></button>
        <button className="camera-button camera-rotate" onClick={() => rotateCamera(1)} aria-label="Rotate map right"><RotateCw size={15} /></button>
        <button className="camera-button camera-reset" onClick={resetCamera} aria-label="Reset map angle"><Crosshair size={15} /></button>
      </div>
      <div className="angle-caption">{view3d ? `OBLIQUE VIEW · ${Math.abs(cameraIndex % 4) + 1} / 4` : "TOP-DOWN VIEW"}</div>
      <div className="map-legend"><span><i className="legend-line fastest-line" /> Fastest</span><span><i className="legend-line cleaner-line" /> Lower PM2.5</span><span><i className="legend-dot air-sample-legend" /> Air-model sample points</span>{reports.length > 0 && <span><i className="legend-dot report-legend" /> Reviewed report</span>}</div>
      <div className="map-disclaimer">Model forecast · not a roadside reading</div>
    </div>
  );
}
