"""Local development AQI adapter for SaansSetu - uses in-memory cache + file storage."""

from __future__ import annotations

import json
import logging
import math
import os
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("saanssetu")

RESOURCE_ID = os.getenv("DATA_GOV_IN_RESOURCE_ID", "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69")
API_KEY = os.getenv("DATA_GOV_IN_API_KEY", "")
SNAPSHOT_FILE = os.getenv("SNAPSHOT_FILE", "/tmp/saanssetu_snapshot.json")
INGEST_TOKEN = os.getenv("INGEST_TOKEN", "replace-with-a-long-random-local-operator-token")

# CPCB AQI concentration breakpoints and AQI breakpoints.
BREAKPOINTS: dict[str, list[tuple[float, float, int, int]]] = {
    "pm2.5": [(0, 30, 0, 50), (31, 60, 51, 100), (61, 90, 101, 200), (91, 120, 201, 300), (121, 250, 301, 400), (251, 500, 401, 500)],
    "pm10": [(0, 50, 0, 50), (51, 100, 51, 100), (101, 250, 101, 200), (251, 350, 201, 300), (351, 430, 301, 400), (431, 600, 401, 500)],
    "no2": [(0, 40, 0, 50), (41, 80, 51, 100), (81, 180, 101, 200), (181, 280, 201, 300), (281, 400, 301, 400), (401, 1000, 401, 500)],
    "so2": [(0, 40, 0, 50), (41, 80, 51, 100), (81, 380, 101, 200), (381, 800, 201, 300), (801, 1600, 301, 400), (1601, 2000, 401, 500)],
    "o3": [(0, 50, 0, 50), (51, 100, 51, 100), (101, 168, 101, 200), (169, 208, 201, 300), (209, 748, 301, 400), (749, 1000, 401, 500)],
    "nh3": [(0, 200, 0, 50), (201, 400, 51, 100), (401, 800, 101, 200), (801, 1200, 201, 300), (1201, 1800, 301, 400), (1801, 2000, 401, 500)],
    "pb": [(0, 0.5, 0, 50), (0.51, 1, 51, 100), (1.01, 2, 101, 200), (2.01, 3, 201, 300), (3.01, 3.5, 301, 400), (3.51, 5, 401, 500)],
    "co": [(0, 1, 0, 50), (1.1, 2, 51, 100), (2.1, 10, 101, 200), (10.1, 17, 201, 300), (17.1, 34, 301, 400), (34.1, 50, 401, 500)],
}

# In-memory cache for local development
_station_history: dict[str, list[dict[str, Any]]] = {}
_latest_snapshot: dict[str, Any] | None = None


def category_for(aqi: int) -> str:
    if aqi <= 50:
        return "Good"
    if aqi <= 100:
        return "Satisfactory"
    if aqi <= 200:
        return "Moderate"
    if aqi <= 300:
        return "Poor"
    if aqi <= 400:
        return "Very Poor"
    return "Severe"


def sub_index(pollutant: str, concentration: float, unit: str = "") -> int | None:
    pollutant_key = pollutant.lower().replace(".", "").replace("_", "").replace("-", "")
    aliases = {"pm25": "pm2.5", "pm2.5": "pm2.5", "pm10": "pm10", "no2": "no2", "so2": "so2", "o3": "o3", "nh3": "nh3", "pb": "pb", "co": "co"}
    key = aliases.get(pollutant_key)
    if key is None:
        return None
    if key == "co" and any(marker in unit.lower() for marker in ("ug", "μg", "µg")):
        concentration /= 1000
    precision = 1 if key == "co" else 2 if key == "pb" else 0
    concentration = round(concentration, precision)
    for low, high, aqi_low, aqi_high in BREAKPOINTS[key]:
        if low <= concentration <= high:
            return round((aqi_high - aqi_low) * (concentration - low) / (high - low) + aqi_low)
    if concentration > BREAKPOINTS[key][-1][1]:
        return 500
    return None


def calculate_aqi(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    indices: dict[str, int] = {}
    for item in records:
        pollutant = str(item.get("pollutant_id", ""))
        value = item.get("pollutant_avg")
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        index = sub_index(pollutant, parsed, str(item.get("pollutant_unit", "")))
        if index is not None:
            canonical = {"pm25": "PM2.5", "pm2.5": "PM2.5", "pm10": "PM10", "no2": "NO2", "so2": "SO2", "o3": "O3", "nh3": "NH3", "pb": "Pb", "co": "CO"}.get(pollutant.lower().replace(".", ""), pollutant.upper())
            indices[canonical] = index
    has_particulate = any(name.replace(".", "") in {"PM25", "PM10"} for name in indices)
    if len(indices) < 3 or not has_particulate:
        return None
    dominant = max(indices, key=indices.get)
    value = indices[dominant]
    concentrations = {}
    for item in records:
        key = str(item.get("pollutant_id", "")).upper()
        try:
            concentrations[key] = round(float(item["pollutant_avg"]), 2)
        except (KeyError, TypeError, ValueError):
            continue
    return {"aqi": value, "category": category_for(value), "dominantPollutant": dominant, "subIndices": indices, "concentrations": concentrations}


def parse_observation_time(value: str) -> datetime | None:
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        parsed = None
        for pattern in ("%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                parsed = datetime.strptime(candidate, pattern)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone(timedelta(hours=5, minutes=30))).astimezone(timezone.utc)
    return parsed.astimezone(timezone.utc)


def station_key(station: dict[str, Any]) -> str:
    identity = f"{station['station']}|{station.get('city')}|{station.get('state')}".lower()
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def fetch_source_records() -> list[dict[str, Any]]:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="Configure DATA_GOV_IN_API_KEY in environment")
    params = urlencode({"api-key": API_KEY, "format": "json", "limit": "1000"})
    url = f"https://api.data.gov.in/resource/{RESOURCE_ID}?{params}"
    try:
        with urlopen(url, timeout=15) as response:
            payload = json.load(response)
    except Exception as exc:
        logger.exception("data.gov.in request failed")
        raise HTTPException(status_code=502, detail="The public AQI data source is temporarily unavailable.") from exc
    records = payload.get("records", [])
    if not isinstance(records, list):
        raise HTTPException(status_code=502, detail="The AQI source returned an unexpected response.")
    return records


def normalize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in records:
        try:
            lat, lon = float(row.get("latitude")), float(row.get("longitude"))
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        station = str(row.get("station", "")).strip()
        city = str(row.get("city", "")).strip()
        updated = str(row.get("last_update", "")).strip()
        if not station or not updated:
            continue
        group_key = (station, city, str(row.get("state", "")))
        grouped.setdefault(group_key, []).append({**row, "latitude": lat, "longitude": lon})

    stations = []
    for (station, city, state), pollutants in grouped.items():
        first = pollutants[0]
        parsed_updates = [parse_observation_time(str(item.get("last_update", ""))) for item in pollutants]
        parsed_updates = [value for value in parsed_updates if value is not None]
        updated = max(parsed_updates).isoformat() if parsed_updates else ""
        stations.append({
            "station": station,
            "city": city,
            "state": state or first.get("state"),
            "latitude": first["latitude"],
            "longitude": first["longitude"],
            "observedAt": updated,
            "source": "data.gov.in · CPCB real-time station feed",
            "pollutants": pollutants,
            "aqi": None,
        })
    return stations


def add_history_and_calculate(stations: list[dict[str, Any]]) -> None:
    global _station_history
    now = datetime.now(timezone.utc).timestamp()
    for station in stations:
        station_id = station_key(station)
        
        # Store pollutant history in memory
        for item in station["pollutants"]:
            pollutant = str(item.get("pollutant_id", "")).lower().replace(".", "")
            if pollutant not in {"pm25", "pm10", "no2", "so2", "o3", "nh3", "co", "pb"}:
                continue
            observed = parse_observation_time(str(item.get("last_update", "")))
            try:
                concentration = float(item.get("pollutant_avg"))
            except (TypeError, ValueError):
                continue
            if observed is None or observed.timestamp() > now + 300 or observed.timestamp() < now - 86400:
                continue
            
            history_key = f"{station_id}:{pollutant}"
            if history_key not in _station_history:
                _station_history[history_key] = []
            _station_history[history_key].append({
                "value": concentration,
                "unit": item.get("pollutant_unit", ""),
                "observedAt": observed.isoformat(),
                "timestamp": observed.timestamp(),
            })
            # Keep only last 24 hours
            _station_history[history_key] = [
                h for h in _station_history[history_key]
                if h["timestamp"] > now - 86400
            ]

        def aqi_at(end_timestamp: float) -> dict[str, Any] | None:
            averaged = []
            for pollutant in ("pm25", "pm10", "no2", "so2", "o3", "nh3", "co", "pb"):
                period = 8 * 3600 if pollutant in {"o3", "co"} else 24 * 3600
                history_key = f"{station_id}:{pollutant}"
                values = [h for h in _station_history.get(history_key, []) if end_timestamp - period <= h["timestamp"] <= end_timestamp]
                hourly: dict[int, tuple[float, str]] = {}
                for h in values:
                    hourly[int(h["timestamp"] // 3600)] = (h["value"], h.get("unit", ""))
                minimum_hours = 6 if pollutant in {"o3", "co"} else 16
                if len(hourly) < minimum_hours:
                    continue
                mean_value = sum(value for value, _ in hourly.values()) / len(hourly)
                unit = next((unit for _, unit in hourly.values() if unit), "")
                averaged.append({"pollutant_id": pollutant, "pollutant_avg": mean_value, "pollutant_unit": unit})
            return calculate_aqi(averaged)

        station["aqi"] = aqi_at(now)
        current_hour = int(now // 3600) * 3600
        trend = [aqi_at(current_hour - hour * 3600) for hour in reversed(range(8))]
        station["trend"] = [item["aqi"] for item in trend if item]


def save_snapshot(stations: list[dict[str, Any]]) -> None:
    global _latest_snapshot
    _latest_snapshot = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "stations": stations,
    }
    try:
        with open(SNAPSHOT_FILE, "w") as f:
            json.dump(_latest_snapshot, f, default=str)
    except Exception as exc:
        logger.exception("Failed to write snapshot file")


def load_snapshot() -> dict[str, Any] | None:
    global _latest_snapshot
    if _latest_snapshot:
        return _latest_snapshot
    try:
        with open(SNAPSHOT_FILE, "r") as f:
            _latest_snapshot = json.load(f)
        return _latest_snapshot
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.exception("Failed to read snapshot file")
        return None


def ingest_source() -> dict[str, Any]:
    records = fetch_source_records()
    stations = normalize_records(records)
    if not stations:
        raise HTTPException(status_code=502, detail="No usable station observations were returned.")

    add_history_and_calculate(stations)
    save_snapshot(stations)

    return {"ingestedStations": len(stations), "records": len(records), "fetchedAt": datetime.now(timezone.utc).isoformat()}


app = FastAPI(title="SaansSetu Schools API (Local)", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Ingest-Token"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "saanssetu-api-local"}


@app.post("/api/aqi/ingest")
def ingest(x_ingest_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if not x_ingest_token or not hmac.compare_digest(x_ingest_token, INGEST_TOKEN):
        raise HTTPException(status_code=403, detail="Ingestion is restricted to operators.")
    try:
        return ingest_source()
    except HTTPException as e:
        if e.status_code == 502:
            # Return mock data for demo when API is unavailable
            return create_mock_snapshot()
        raise


def create_mock_snapshot() -> dict[str, Any]:
    """Create mock station data for demo when live API is unavailable."""
    mock_stations = [
        {
            "station": "ITO, Delhi - CPCB",
            "city": "Delhi",
            "state": "Delhi",
            "latitude": 28.6139,
            "longitude": 77.209,
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "source": "data.gov.in · CPCB real-time station feed (MOCK)",
            "pollutants": [
                {"pollutant_id": "PM2.5", "pollutant_avg": 112, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "PM10", "pollutant_avg": 180, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "NO2", "pollutant_avg": 45, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
            ],
            "aqi": {"aqi": 286, "category": "Poor", "dominantPollutant": "PM2.5", "subIndices": {"PM2.5": 286, "PM10": 180, "NO2": 45}, "concentrations": {"PM2.5": 112, "PM10": 180, "NO2": 45}},
            "trend": [128, 137, 160, 178, 186, 202, 241, 286],
        },
        {
            "station": "Muradpur, Patna - BSPCB",
            "city": "Patna",
            "state": "Bihar",
            "latitude": 25.5941,
            "longitude": 85.1376,
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "source": "data.gov.in · CPCB real-time station feed (MOCK)",
            "pollutants": [
                {"pollutant_id": "PM2.5", "pollutant_avg": 65, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "PM10", "pollutant_avg": 109, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "NO2", "pollutant_avg": 30, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
            ],
            "aqi": {"aqi": 154, "category": "Moderate", "dominantPollutant": "PM10", "subIndices": {"PM2.5": 108, "PM10": 154, "NO2": 30}, "concentrations": {"PM2.5": 65, "PM10": 109, "NO2": 30}},
            "trend": [110, 118, 130, 128, 142, 148, 151, 154],
        },
        {
            "station": "Dhanbad - CPCB",
            "city": "Dhanbad",
            "state": "Jharkhand",
            "latitude": 23.7957,
            "longitude": 86.4304,
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "source": "data.gov.in · CPCB real-time station feed (MOCK)",
            "pollutants": [
                {"pollutant_id": "PM2.5", "pollutant_avg": 31, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "PM10", "pollutant_avg": 78, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "NO2", "pollutant_avg": 20, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
            ],
            "aqi": {"aqi": 92, "category": "Satisfactory", "dominantPollutant": "PM2.5", "subIndices": {"PM2.5": 92, "PM10": 78, "NO2": 20}, "concentrations": {"PM2.5": 31, "PM10": 78, "NO2": 20}},
            "trend": [70, 73, 82, 90, 85, 88, 91, 92],
        },
        {
            "station": "BTM Layout, Bengaluru - CPCB",
            "city": "Bengaluru",
            "state": "Karnataka",
            "latitude": 12.9716,
            "longitude": 77.5946,
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "source": "data.gov.in · CPCB real-time station feed (MOCK)",
            "pollutants": [
                {"pollutant_id": "PM2.5", "pollutant_avg": 25, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "PM10", "pollutant_avg": 54, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
                {"pollutant_id": "NO2", "pollutant_avg": 15, "pollutant_unit": "µg/m³", "last_update": datetime.now(timezone.utc).isoformat()},
            ],
            "aqi": {"aqi": 67, "category": "Satisfactory", "dominantPollutant": "PM10", "subIndices": {"PM2.5": 42, "PM10": 67, "NO2": 15}, "concentrations": {"PM2.5": 25, "PM10": 54, "NO2": 15}},
            "trend": [58, 60, 57, 63, 61, 64, 66, 67],
        },
    ]
    save_snapshot(mock_stations)
    return {"ingestedStations": len(mock_stations), "records": len(mock_stations) * 3, "fetchedAt": datetime.now(timezone.utc).isoformat(), "mock": True}


@app.get("/api/aqi/nearest")
def nearest(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)) -> dict[str, Any]:
    snapshot = load_snapshot()
    if not snapshot:
        raise HTTPException(status_code=503, detail="No fresh station data is available. Run ingestion first.")
    stations = snapshot.get("stations", [])
    if not stations:
        raise HTTPException(status_code=404, detail="No monitoring stations are available.")
    eligible = [item for item in stations if item.get("aqi")]
    if not eligible:
        return {"mode": "unavailable", "observation": None, "reason": "No station currently has enough valid readings to calculate CPCB AQI."}
    station = min(eligible, key=lambda item: haversine_km(lat, lon, item["latitude"], item["longitude"]))
    distance = round(haversine_km(lat, lon, station["latitude"], station["longitude"]), 1)
    observed_at = station.get("observedAt") or snapshot.get("fetchedAt")
    parsed_observed = parse_observation_time(str(observed_at))
    age_minutes = max(0, int((datetime.now(timezone.utc) - parsed_observed).total_seconds() / 60)) if parsed_observed else None
    return {
        "mode": "live",
        "observation": {
            "aqi": station["aqi"]["aqi"],
            "category": station["aqi"]["category"],
            "pollutant": station["aqi"]["dominantPollutant"],
            "value": station["aqi"]["concentrations"].get(station["aqi"]["dominantPollutant"]),
            "unit": next((item.get("pollutant_unit") for item in station["pollutants"] if str(item.get("pollutant_id", "")).upper().replace(".", "") == station["aqi"]["dominantPollutant"]), ""),
            "station": f"{station['station']} · {station.get('city') or station.get('state') or 'India'}",
            "distanceKm": distance,
            "observedAt": observed_at,
            "freshnessStatus": "fresh" if age_minutes is not None and age_minutes <= 180 else "delayed",
            "ageMinutes": age_minutes,
            "source": station["source"],
            "confidence": f"Nearest public station · {distance} km",
            "trend": station.get("trend", []),
        },
        "fetchedAt": snapshot.get("fetchedAt"),
    }