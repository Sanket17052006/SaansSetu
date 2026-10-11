const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function authHeaders(session) {
  if (session?.mode === "cognito" && session.accessToken) return { Authorization: `Bearer ${session.accessToken}` };
  return {};
}

export async function getAirSnapshot(school, signal) {
  if (!API_BASE) return null;
  const response = await fetch(`${API_BASE}/api/aqi/nearest?lat=${school.lat}&lon=${school.lon}`, { signal, headers: authHeaders(readSession()) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || detail.message || `AQI service returned ${response.status}.`);
  }
  const data = await response.json();
  if (!data.observation) return { observation: null, mode: "unavailable", reason: data.reason || "No standards-eligible station reading is available." };
  return { observation: data.observation, mode: data.mode === "live" ? "live" : "demo" };
}

export async function subscribeToAlerts({ schoolId, threshold }, session) {
  if (session?.mode === "demo") {
    try { localStorage.setItem(`saanssetu.alert.${schoolId}`, JSON.stringify({ threshold, enabled: true, updatedAt: new Date().toISOString() })); } catch { /* Demo preference is optional. */ }
    return { mode: "demo" };
  }
  if (!API_BASE) throw new Error("School alerts need the connected SaansSetu API. The cloud API is not configured yet.");
  const response = await fetch(`${API_BASE}/api/alerts/subscriptions`, { method: "POST", headers: { ...authHeaders(session), "Content-Type": "application/json" }, body: JSON.stringify({ schoolId, threshold }) });
  if (!response.ok) throw new Error("Could not save this alert preference.");
  return response.json();
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem("saanssetu.session") || "null"); } catch { return null; }
}
