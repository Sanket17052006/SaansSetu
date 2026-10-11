const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export function isReportServiceConfigured() {
  return Boolean(API_BASE);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.ok) throw new Error(`Community service returned ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

export async function getReports(signal) {
  if (!isReportServiceConfigured()) return [];
  const payload = await request("/reports", { signal });
  const reports = Array.isArray(payload) ? payload : payload?.reports ?? [];
  return reports.map((report) => ({ ...report, lat: report.lat ?? report.latitude, lng: report.lng ?? report.longitude }));
}

export async function submitReport(report) {
  if (!isReportServiceConfigured()) throw new Error("Community reports are not available right now.");
  return request("/reports", { method: "POST", body: JSON.stringify(report) });
}
