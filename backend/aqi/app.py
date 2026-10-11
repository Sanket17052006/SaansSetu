"""AWS Lambda AQI adapter for SaansSetu - uses DynamoDB + S3 instead of Redis/Kafka."""

from __future__ import annotations

import json
import logging
import math
import os
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import boto3
from botocore.exceptions import ClientError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("saanssetu")

RESOURCE_ID = os.getenv("DATA_GOV_IN_RESOURCE_ID", "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69")
STATIONS_TABLE = os.getenv("STATIONS_TABLE", "saanssetu-stations")
SNAPSHOT_BUCKET = os.getenv("SNAPSHOT_BUCKET", "")
DATA_GOV_IN_SECRET_ARN = os.getenv("DATA_GOV_IN_SECRET_ARN", "")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)
secrets_client = boto3.client("secretsmanager", region_name=AWS_REGION)

stations_table = dynamodb.Table(STATIONS_TABLE)

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


def get_api_key() -> str:
    # Local development: use API key directly from env
    local_key = os.getenv("DATA_GOV_IN_API_KEY", "")
    if local_key:
        return local_key
    
    # AWS deployment: use Secrets Manager
    if not DATA_GOV_IN_SECRET_ARN:
        raise HTTPException(status_code=503, detail="DATA_GOV_IN_SECRET_ARN not configured")
    try:
        response = secrets_client.get_secret_value(SecretId=DATA_GOV_IN_SECRET_ARN)
        secret = json.loads(response["SecretString"])
        return secret.get("api_key", "")
    except ClientError as exc:
        logger.exception("Failed to retrieve data.gov.in API key from Secrets Manager")
        raise HTTPException(status_code=503, detail="Unable to retrieve API key") from exc


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
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="data.gov.in API key is empty in Secrets Manager")
    params = urlencode({"api-key": api_key, "format": "json", "limit": "1000"})
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
    now = datetime.now(timezone.utc).timestamp()
    for station in stations:
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

        station_id = station_key(station)
        def aqi_at(end_timestamp: float) -> dict[str, Any] | None:
            averaged = []
            for pollutant in ("pm25", "pm10", "no2", "so2", "o3", "nh3", "co", "pb"):
                period = 8 * 3600 if pollutant in {"o3", "co"} else 24 * 3600
                response = stations_table.query(
                    KeyConditionExpression="station_id = :sid AND pollutant_timestamp BETWEEN :start AND :end",
                    ExpressionAttributeValues={
                        ":sid": f"{station_id}#{pollutant}",
                        ":start": end_timestamp - period,
                        ":end": end_timestamp,
                    },
                )
                items = response.get("Items", [])
                hourly: dict[int, tuple[float, str]] = {}
                for item in items:
                    try:
                        hourly[int(item["hour_bucket"])] = (float(item["value"]), str(item.get("unit", "")))
                    except (ValueError, TypeError, KeyError):
                        continue
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


def ingest_source() -> dict[str, Any]:
    records = fetch_source_records()
    stations = normalize_records(records)
    if not stations:
        raise HTTPException(status_code=502, detail="No usable station observations were returned.")

    add_history_and_calculate(stations)

    try:
        with stations_table.batch_writer() as batch:
            for station in stations:
                station_id = station_key(station)
                item = {
                    "station_id": station_id,
                    "city": station.get("city", ""),
                    "state": station.get("state", ""),
                    "station_name": station["station"],
                    "latitude": station["latitude"],
                    "longitude": station["longitude"],
                    "observedAt": station["observedAt"],
                    "source": station["source"],
                    "aqi": station.get("aqi"),
                    "trend": station.get("trend", []),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
                batch.put_item(Item=item)

                if station.get("aqi"):
                    for pollutant in ("pm25", "pm10", "no2", "so2", "o3", "nh3", "co", "pb"):
                        period = 8 * 3600 if pollutant in {"o3", "co"} else 24 * 3600
                        history_items = []
                        for obs in station["pollutants"]:
                            p = str(obs.get("pollutant_id", "")).lower().replace(".", "")
                            if p != pollutant:
                                continue
                            observed = parse_observation_time(str(obs.get("last_update", "")))
                            if not observed:
                                continue
                            try:
                                value = float(obs.get("pollutant_avg"))
                            except (TypeError, ValueError):
                                continue
                            hour_bucket = int(observed.timestamp() // 3600)
                            history_items.append({
                                "station_id": f"{station_id}#{pollutant}",
                                "pollutant_timestamp": observed.timestamp(),
                                "hour_bucket": hour_bucket,
                                "value": value,
                                "unit": obs.get("pollutant_unit", ""),
                            })
                        for h in history_items[-period//3600:]:
                            batch.put_item(Item=h)

        if SNAPSHOT_BUCKET and stations:
            snapshot = {
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "stations": stations,
            }
            s3.put_object(
                Bucket=SNAPSHOT_BUCKET,
                Key="latest-stations.json",
                Body=json.dumps(snapshot, default=str).encode("utf-8"),
                ContentType="application/json",
            )
    except ClientError as exc:
        logger.exception("Failed to write to DynamoDB or S3")
        raise HTTPException(status_code=503, detail="Storage layer unavailable") from exc

    return {"ingestedStations": len(stations), "records": len(records), "fetchedAt": datetime.now(timezone.utc).isoformat()}


def get_latest_snapshot() -> dict[str, Any] | None:
    if not SNAPSHOT_BUCKET:
        return None
    try:
        response = s3.get_object(Bucket=SNAPSHOT_BUCKET, Key="latest-stations.json")
        return json.loads(response["Body"].read().decode("utf-8"))
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchKey":
            return None
        logger.exception("Failed to read snapshot from S3")
        raise HTTPException(status_code=503, detail="Snapshot unavailable") from exc


app = FastAPI(title="SaansSetu Schools API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "saanssetu-api"}


@app.post("/api/aqi/ingest")
def ingest() -> dict[str, Any]:
    return ingest_source()


@app.get("/api/aqi/nearest")
def nearest(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)) -> dict[str, Any]:
    snapshot = get_latest_snapshot()
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