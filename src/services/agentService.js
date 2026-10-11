/**
 * Local AQI Agent - Strands-inspired agent for school air actions
 * Runs entirely in-browser, no external LLM needed
 */

const AQI_CATEGORIES = {
  good: { max: 50, label: "Good", color: "good", emoji: "🟢" },
  satisfactory: { max: 100, label: "Satisfactory", color: "satisfactory", emoji: "🟡" },
  moderate: { max: 200, label: "Moderate", color: "moderate", emoji: "🟠" },
  poor: { max: 300, label: "Poor", color: "poor", emoji: "🔴" },
  "very-poor": { max: 400, label: "Very Poor", color: "very-poor", emoji: "🟣" },
  severe: { max: 500, label: "Severe", color: "severe", emoji: "🟤" },
};

const SCHOOL_ACTIONS = {
  good: [
    "Continue all outdoor activities as planned",
    "No special precautions needed",
  ],
  satisfactory: [
    "Continue usual activities",
    "Sensitive students may take breaks if needed",
  ],
  moderate: [
    "Reduce prolonged outdoor exertion for sensitive students",
    "Keep inhalers accessible for asthma students",
    "Consider indoor alternatives for PE",
  ],
  poor: [
    "Move all physical activities indoors",
    "Keep windows/doors closed",
    "Activate air purifiers if available",
    "Alert staff to watch for symptoms",
  ],
  "very-poor": [
    "Suspend outdoor activities entirely",
    "Limit classroom ventilation to filtered air",
    "Check vulnerable students every hour",
    "Prepare for possible early dismissal if district advises",
  ],
  severe: [
    "Follow district/state emergency protocol",
    "Keep all students indoors",
    "Coordinate with district for closure decision",
    "Send immediate parent notification",
  ],
};

function getCategory(aqi) {
  if (aqi <= 50) return AQI_CATEGORIES.good;
  if (aqi <= 100) return AQI_CATEGORIES.satisfactory;
  if (aqi <= 200) return AQI_CATEGORIES.moderate;
  if (aqi <= 300) return AQI_CATEGORIES.poor;
  if (aqi <= 400) return AQI_CATEGORIES["very-poor"];
  return AQI_CATEGORIES.severe;
}

function getActions(categoryKey) {
  return SCHOOL_ACTIONS[categoryKey] || SCHOOL_ACTIONS.moderate;
}

function timeAgo(dateStr) {
  if (!dateStr) return "unknown time";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

export class AQIAgent {
  constructor(apiBaseUrl = "") {
    this.apiBaseUrl = apiBaseUrl || import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
    this.cache = new Map();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(data) {
    this.listeners.forEach(l => l(data));
  }

  async geocodeLocation(query) {
    const cacheKey = `geo:${query.toLowerCase()}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&osm_tag=amenity:school`);
      const data = await res.json();
      const schools = data.features?.map(f => ({
        id: f.properties.osm_id,
        name: f.properties.name,
        city: f.properties.city,
        state: f.properties.state,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      })) || [];
      this.cache.set(cacheKey, schools);
      return schools;
    } catch (e) {
      console.error("Geocode failed:", e);
      return [];
    }
  }

  async fetchAQI(lat, lon) {
    const cacheKey = `aqi:${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 5 * 60000) return cached.data;
    }

    try {
      const res = await fetch(`${this.apiBaseUrl}/api/aqi/nearest?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (e) {
      console.error("AQI fetch failed:", e);
      return { mode: "error", error: e.message };
    }
  }

  async triggerIngestion() {
    try {
      const res = await fetch(`${this.apiBaseUrl}/api/aqi/ingest`, { method: "POST" });
      return await res.json();
    } catch (e) {
      console.error("Ingestion trigger failed:", e);
      return { error: e.message };
    }
  }

  draftMessage(school, observation, audience = "Parents and guardians", role = "educator") {
    const cat = getCategory(observation.aqi);
    const actions = getActions(cat.label.toLowerCase().replace(" ", "-"));
    const isPrincipal = role === "school_admin";

    const header = isPrincipal
      ? `Official update from ${school.name}`
      : `Draft for principal review — ${school.name}`;

    const lines = [
      header,
      "",
      `Dear ${audience},`,
      "",
      `Sans Setu air quality update for ${school.name}:`,
      `• Nearest monitor: ${observation.station} (${observation.distanceKm} km away)`,
      `• India AQI: ${observation.aqi} (${observation.category})`,
      `• Dominant pollutant: ${observation.pollutant} at ${observation.value} ${observation.unit}`,
      `• Reading from: ${timeAgo(observation.observedAt)}`,
      "",
      `This is contextual data from the nearest public monitor — not a measurement at the school gate.`,
      "",
      "Today's school plan:",
      ...actions.map(a => `• ${a}`),
      "",
      "Please follow official school and district instructions.",
      "We will share another update if conditions or guidance change.",
      "",
      isPrincipal ? `— ${school.name} office` : `— Prepared for principal review`,
    ];

    return lines.join("\n");
  }

  generateActionChecklist(category) {
    const cat = getCategory(category);
    return getActions(cat.label.toLowerCase().replace(" ", "-")).map((action, i) => ({
      id: i,
      text: action,
      done: false,
    }));
  }

  async runFullCycle(schoolQuery, audience = "Parents and guardians", role = "educator") {
    this.notify({ status: "geocoding", query: schoolQuery });

    const schools = await this.geocodeLocation(schoolQuery);
    if (!schools.length) {
      this.notify({ status: "error", message: "No schools found for that query" });
      return null;
    }

    const school = schools[0];
    this.notify({ status: "fetching-aqi", school });

    const aqiResult = await this.fetchAQI(school.lat, school.lon);
    if (aqiResult.mode !== "live") {
      this.notify({ status: "unavailable", school, reason: aqiResult.reason || "No eligible AQI" });
      return { school, aqi: null, message: null };
    }

    const observation = aqiResult.observation;
    const message = this.draftMessage(school, observation, audience, role);
    const checklist = this.generateActionChecklist(observation.category);

    const result = {
      school,
      observation,
      message,
      checklist,
      timestamp: new Date().toISOString(),
    };

    this.notify({ status: "complete", ...result });
    return result;
  }

  // Scheduled task runner (call periodically)
  async startMonitoring(school, intervalMs = 15 * 60000) {
    const run = async () => {
      const aqiResult = await this.fetchAQI(school.lat, school.lon);
      if (aqiResult.mode === "live") {
        this.notify({ status: "update", observation: aqiResult.observation });
      }
    };
    await run();
    const timer = setInterval(run, intervalMs);
    return () => clearInterval(timer);
  }
}

export const agent = new AQIAgent();