import { useEffect, useMemo, useState, useRef } from "react";
import { Activity, ArrowRight, Bell, Bot, Check, Clock3, CloudSun, Copy, ExternalLink, HeartPulse, LocateFixed, LogOut, MapPin, Menu, MessageCircle, RefreshCw, Share2, ShieldCheck, Wind, X, Zap } from "lucide-react";
import WelcomeScreen from "./components/WelcomeScreen.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import SchoolSearch from "./components/SchoolSearch.jsx";
import { getAirSnapshot, subscribeToAlerts } from "./services/aqiService.js";
import { getSession, signOut } from "./services/authService.js";
import { agent } from "./services/agentService.js";

const SCHOOL_ACTIONS = {
  Good: { title: "A good day to learn outside", color: "good", actions: ["Usual outdoor play and sports can continue.", "Keep checking the school air card during the day."] },
  Satisfactory: { title: "Keep your normal routine", color: "satisfactory", actions: ["Continue usual school activities.", "Sensitive students can take breaks if they feel discomfort."] },
  Moderate: { title: "Protect sensitive students", color: "moderate", actions: ["Reduce prolonged or strenuous outdoor activity for students with respiratory sensitivity.", "Keep the school air card visible to staff."] },
  Poor: { title: "Move physical activity indoors", color: "poor", actions: ["Avoid outdoor physical activity; move sports and assembly indoors where possible.", "Keep windows closed when outdoor air is poor; follow local health guidance."] },
  "Very Poor": { title: "Limit outdoor exposure", color: "very-poor", actions: ["Keep students indoors during breaks and avoid outdoor exertion.", "Check vulnerable students and follow local health and education advisories."] },
  Severe: { title: "Use your school’s severe-air protocol", color: "severe", actions: ["Avoid outdoor activities and follow district or state instructions.", "Notify staff and families with the verified local reading and time."] },
};

const DEMO_SCHOOLS = [
  { id: "school-delhi", name: "Riverstone Public School", city: "New Delhi", state: "Delhi", lat: 28.6139, lon: 77.209, station: "ITO, Delhi - CPCB", distanceKm: 2.7 },
  { id: "school-patna", name: "Ganga Valley Academy", city: "Patna", state: "Bihar", lat: 25.5941, lon: 85.1376, station: "Muradpur, Patna - BSPCB", distanceKm: 3.4 },
  { id: "school-dhanbad", name: "Dhanbad Model School", city: "Dhanbad", state: "Jharkhand", lat: 23.7957, lon: 86.4304, station: "Dhanbad - CPCB", distanceKm: 4.1 },
  { id: "school-bengaluru", name: "Lakeview Learning Centre", city: "Bengaluru", state: "Karnataka", lat: 12.9716, lon: 77.5946, station: "BTM Layout, Bengaluru - CPCB", distanceKm: 3.8 },
];

const DEMO_OBSERVATIONS = {
  "school-delhi": { aqi: 286, category: "Poor", pollutant: "PM2.5", value: 112, unit: "µg/m³", station: "ITO, Delhi - CPCB", distanceKm: 2.7, observedAt: new Date(Date.now() - 18 * 60_000).toISOString(), source: "DEMO SAMPLE · CPCB OGD integration pending", confidence: "Nearby station · 2.7 km", trend: [128, 137, 160, 178, 186, 202, 241, 286] },
  "school-patna": { aqi: 154, category: "Moderate", pollutant: "PM10", value: 109, unit: "µg/m³", station: "Muradpur, Patna - BSPCB", distanceKm: 3.4, observedAt: new Date(Date.now() - 31 * 60_000).toISOString(), source: "DEMO SAMPLE · CPCB OGD integration pending", confidence: "Nearby station · 3.4 km", trend: [110, 118, 130, 128, 142, 148, 151, 154] },
  "school-dhanbad": { aqi: 92, category: "Satisfactory", pollutant: "PM2.5", value: 31, unit: "µg/m³", station: "Dhanbad - CPCB", distanceKm: 4.1, observedAt: new Date(Date.now() - 46 * 60_000).toISOString(), source: "DEMO SAMPLE · CPCB OGD integration pending", confidence: "Nearby station · 4.1 km", trend: [70, 73, 82, 90, 85, 88, 91, 92] },
  "school-bengaluru": { aqi: 67, category: "Satisfactory", pollutant: "PM10", value: 54, unit: "µg/m³", station: "BTM Layout, Bengaluru - CPCB", distanceKm: 3.8, observedAt: new Date(Date.now() - 12 * 60_000).toISOString(), source: "DEMO SAMPLE · CPCB OGD integration pending", confidence: "Nearby station · 3.8 km", trend: [58, 60, 57, 63, 61, 64, 66, 67] },
};

function unavailableObservation(reason = "No standards-eligible local reading is available.") {
  return { aqi: null, category: "Awaiting data", pollutant: "—", value: "—", unit: "", station: "No eligible nearby public monitor", distanceKm: null, observedAt: null, source: reason, confidence: "Coverage not established", trend: [] };
}

function timeAgo(date) {
  if (!date || !Number.isFinite(new Date(date).getTime())) return "time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function getPolicy(category) {
  return SCHOOL_ACTIONS[category] || SCHOOL_ACTIONS.Moderate;
}

function App() {
  const [screen, setScreen] = useState(() => getSession() ? "dashboard" : "welcome");
  const [session, setSession] = useState(() => getSession());
  const [selectedId, setSelectedId] = useState("school-delhi");
  const [discoveredSchools, setDiscoveredSchools] = useState([]);
  const [observations, setObservations] = useState(DEMO_OBSERVATIONS);
  const [sourceState, setSourceState] = useState("demo");
  const [sourceReason, setSourceReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [messageAudience, setMessageAudience] = useState("Parents and guardians");
  const [messageDraft, setMessageDraft] = useState(null);
  const [messageStatus, setMessageStatus] = useState("");
  const [actionChecks, setActionChecks] = useState({});
  const selectedSchool = DEMO_SCHOOLS.find((school) => school.id === selectedId) || discoveredSchools.find((school) => school.id === selectedId) || DEMO_SCHOOLS[0];
  const observation = observations[selectedId] || DEMO_OBSERVATIONS[selectedId] || unavailableObservation("No verified reading available.");
  const policy = getPolicy(observation.category);
  const isDistrict = session?.role === "district_officer";
  const isPrincipal = session?.role === "school_admin";

  const suggestedMessage = `Dear ${messageAudience},\n\nSaansSetu school air update for ${selectedSchool.name}: the nearest public monitoring station reports an India AQI of ${observation.aqi} (${observation.category}), updated ${timeAgo(observation.observedAt)}. The station is ${observation.distanceKm} km from our school, so this is local context and not a measurement from the school campus.\n\nToday’s school plan: ${policy.actions[0]} ${policy.actions[1]}\n\nPlease follow official school and district instructions. We will share another update if conditions or guidance change.\n\n— ${session?.schoolName || selectedSchool.name} office`;
  const currentMessage = messageDraft ?? suggestedMessage;
  const actionLogKey = `saanssetu.actionLog.${selectedId}.${new Date().toISOString().slice(0, 10)}`;
  const responseActions = ["Review the school plan against the latest reading", "Brief teachers and activity leads", "Share a reviewed update with families"];

  function applySnapshot(result) {
    if (result?.observation) {
      setObservations((previous) => ({ ...previous, [selectedId]: result.observation }));
      setSourceState(result.mode || "live");
      setSourceReason("");
      setLastUpdated(new Date());
    } else if (result?.mode === "unavailable") {
      setObservations((previous) => ({ ...previous, [selectedId]: unavailableObservation(result.reason) }));
      setSourceState("unavailable");
      setSourceReason(result.reason || "No standards-eligible station reading is available.");
    } else {
      setSourceState("demo");
      setSourceReason("");
    }
  }

  useEffect(() => {
    try { setActionChecks(JSON.parse(localStorage.getItem(actionLogKey) || "{}")); }
    catch { setActionChecks({}); }
  }, [actionLogKey]);

  useEffect(() => {
    if (screen !== "dashboard") return undefined;
    const controller = new AbortController();
    setLoading(true);
    getAirSnapshot(selectedSchool, controller.signal)
      .then((result) => { applySnapshot(result); setError(""); })
      .catch((reason) => { if (reason.name !== "AbortError") { setError(reason.message); setSourceState("unavailable"); setObservations((previous) => ({ ...previous, [selectedId]: unavailableObservation(reason.message) })); } })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [screen, selectedId, selectedSchool]);

  useEffect(() => {
    if (screen !== "dashboard") return undefined;
    const timer = window.setInterval(() => {
      const controller = new AbortController();
      getAirSnapshot(selectedSchool, controller.signal).then(applySnapshot).catch(() => {});
    }, 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [screen, selectedId, selectedSchool]);

  useEffect(() => { setMessageDraft(null); setMessageStatus(""); }, [selectedId, observation.aqi, observation.category]);

  const schools = useMemo(() => isDistrict ? DEMO_SCHOOLS : DEMO_SCHOOLS.slice(0, 3), [isDistrict]);
  const criticalCount = DEMO_SCHOOLS.filter((school) => ["Poor", "Very Poor", "Severe"].includes((observations[school.id] || DEMO_OBSERVATIONS[school.id]).category)).length;
  function selectSchool(school) {
    if (!DEMO_SCHOOLS.some((item) => item.id === school.id)) setDiscoveredSchools((previous) => [school, ...previous.filter((item) => item.id !== school.id)]);
    setSelectedId(school.id);
    setSourceState("loading");
    setMobileNav(false);
  }
  function toggleResponseAction(index) {
    const next = { ...actionChecks, [index]: !actionChecks[index] };
    setActionChecks(next);
    try { localStorage.setItem(actionLogKey, JSON.stringify(next)); } catch { /* Local response notes are optional. */ }
  }

  function openAuth(mode = "login") { setScreen("auth"); window.history.replaceState(null, "", `#${mode}`); }
  function onAuthenticated(nextSession) { setSession(nextSession); setScreen("dashboard"); window.history.replaceState(null, "", "#school"); }
  function handleSignOut() { signOut(); setSession(null); setScreen("welcome"); }

  async function enableAlerts() {
    if (!session) return openAuth("signup");
    try {
      await subscribeToAlerts({ schoolId: selectedSchool.id, threshold: 201 }, session);
      setAlertsEnabled(true);
      setNotice(sourceState === "demo" ? "Demo alert preference saved on this device." : "School alert preference saved.");
    } catch (reason) { setNotice(reason.message || "Could not save the alert preference."); }
    window.setTimeout(() => setNotice(""), 3800);
  }

  async function shareParentMessage() {
    if (!isPrincipal) {
      setMessageStatus("Only a verified school administrator can share an official school message. You can copy this draft for the principal to review.");
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: `SaansSetu update · ${selectedSchool.name}`, text: currentMessage });
        setMessageStatus("Shared from your device. Confirm delivery in the selected school channel.");
      } else {
        await navigator.clipboard.writeText(currentMessage);
        setMessageStatus("Message copied. Paste it into the selected parent or school group and confirm delivery there.");
      }
    } catch (reason) {
      if (reason.name !== "AbortError") setMessageStatus("Could not open sharing. Copy the message and paste it into your school channel.");
    }
  }

  async function copyParentMessage() {
    try {
      await navigator.clipboard.writeText(currentMessage);
      setMessageStatus(isPrincipal ? "Copied. Paste it into the official school channel and confirm delivery." : "Copied as a draft for the principal to review.");
    } catch {
      setMessageStatus("Clipboard access is unavailable. Select and copy the message text manually.");
    }
  }

  if (screen === "welcome") return <WelcomeScreen onLogin={() => openAuth("login")} onStart={() => openAuth("signup")} onDemo={(demoSession) => onAuthenticated(demoSession)} />;
  if (screen === "auth") return <AuthScreen onAuthenticated={onAuthenticated} onBack={() => setScreen("welcome")} />;

  return <div className="school-app">
    <header className="school-topbar">
      <button className="school-brand" onClick={() => setScreen("welcome")} aria-label="SaansSetu home"><span className="brand-orbit"><Wind size={19} /></span><span><b>SaansSetu</b><small>SCHOOLS · INDIA</small></span></button>
      <div className="topbar-context"><span className="fresh-pip" /> SCHOOL AIR BRIEF <i>·</i> {formatDay(new Date())}</div>
      <div className="topbar-user"><span className="role-chip">{session?.roleLabel || "Educator"}</span><span className="user-initial">{(session?.name || session?.email || "S").charAt(0).toUpperCase()}</span><button className="signout-button" onClick={handleSignOut} aria-label="Sign out"><LogOut size={16} /></button></div>
    </header>
    <div className="school-layout">
      <aside className={`school-sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-heading"><div><span className="tiny-label">YOUR SCHOOL NETWORK</span><h2>{isDistrict ? "District view" : "My school"}</h2></div><button className="mobile-sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close schools"><X size={18} /></button></div>
        {isDistrict && <div className="district-badge"><ShieldCheck size={14} /> VERIFIED DISTRICT VIEW</div>}
        <SchoolSearch value={selectedSchool} schools={schools} onSelect={selectSchool} />
        <div className="network-summary"><div><span>MONITORED</span><b>{schools.length.toString().padStart(2, "0")}</b></div><div><span>NEED ATTENTION</span><b className={criticalCount ? "attention-number" : ""}>{criticalCount.toString().padStart(2, "0")}</b></div></div>
        <div className="school-list-label"><span>NETWORK AIR STATUS</span><span>{sourceState === "live" ? "LATEST" : "SAMPLE"}</span></div>
        <div className="school-list">{schools.map((school) => { const item = observations[school.id] || DEMO_OBSERVATIONS[school.id]; const itemPolicy = getPolicy(item.category); return <button className={`school-row ${school.id === selectedId ? "school-row-active" : ""}`} key={school.id} onClick={() => setSelectedId(school.id)}><span className={`school-dot ${itemPolicy.color}`} /><span className="school-row-copy"><b>{school.name}</b><small>{school.city}, {school.state}</small></span><span className="school-row-aqi"><b>{item.aqi}</b><small>{item.category}</small></span></button>; })}</div>
        <div className="sidebar-bottom"><span className="source-mark"><span>DATA</span> CPCB · OGD</span><p>Nearest official monitor shown with its distance and update time. A monitor reading is not a measurement at the school gate.</p><button onClick={handleSignOut}><LogOut size={14} /> Sign out</button></div>
      </aside>

      <main className="school-content">
        <div className="content-header"><button className="mobile-sidebar-trigger" onClick={() => setMobileNav(true)} aria-label="Open schools"><Menu size={19} /></button><div><span className="tiny-label">SCHOOL AIR · {selectedSchool.state.toUpperCase()}</span><h1>{selectedSchool.name}<span>{selectedSchool.city}</span></h1></div><button className={`alert-button ${alertsEnabled ? "alert-on" : ""}`} onClick={enableAlerts}><Bell size={15} />{alertsEnabled ? "Alerts on" : "Set school alerts"}</button></div>
        {sourceState !== "live" && <div className="demo-banner"><span>{sourceState === "loading" ? "CHECKING" : sourceState === "unavailable" ? "NO ELIGIBLE READING" : "SAMPLE DATA"}</span> {sourceState === "loading" ? "Looking for the latest eligible public monitor near this school." : sourceState === "unavailable" ? sourceReason || "No standards-eligible AQI is available for this location." : "Illustrative school example. Configure the CPCB Open Government Data API to load station observations."}</div>}
        {session?.requestedRole === "school_admin" && !session.approved && <div className="fetch-banner"><ShieldCheck size={15} /> School administrator access is not active. This account has educator permissions until a school verification workflow approves it.</div>}
        {error && <div className="fetch-banner" role="status"><CloudSun size={15} /> Live update unavailable: {error} · No live value is displayed until the source returns.</div>}
        <section className={`air-hero air-${policy.color}`}>
          <div className="air-hero-orb" /><div className="air-hero-top"><div><span className="reading-kicker"><span className="reading-pulse" /> {sourceState === "live" ? "LATEST ELIGIBLE STATION READING" : "SCHOOL AIR BRIEF"}</span><h2>{observation.aqi === null ? "Waiting for a nearby monitor" : policy.title}</h2></div><div className="aqi-reading"><span>INDIA AQI</span><b>{observation.aqi ?? "—"}</b><small>{observation.category}</small></div></div>
          <div className="air-hero-bottom"><div className="main-action"><span className="action-label">WHAT TO DO AT SCHOOL</span><p>{observation.aqi === null ? "No standards-eligible local AQI is available yet." : policy.actions[0]}</p><span className="action-sub">{observation.aqi === null ? "Try a nearby city or check again when the public station feed updates." : policy.actions[1]}</span></div><div className="reading-meta"><span><MapPin size={14} />{observation.station}</span><span><LocateFixed size={14} />{observation.distanceKm === null ? "Distance unavailable" : `${observation.distanceKm} km from school`}</span><span><Clock3 size={14} />{observation.observedAt ? `Updated ${timeAgo(observation.observedAt)}` : "No observation timestamp"}</span></div></div>
        </section>

        <div className="metrics-grid"><article className="metric-card"><span className="metric-icon pm-icon"><Wind size={17} /></span><span className="metric-label">DOMINANT POLLUTANT</span><b>{observation.pollutant}</b><small>{observation.value} {observation.unit}</small></article><article className="metric-card"><span className="metric-icon station-icon"><MapPin size={17} /></span><span className="metric-label">NEAREST MONITOR</span><b>{observation.distanceKm === null ? "—" : `${observation.distanceKm} km`}</b><small>{observation.confidence}</small></article><article className="metric-card"><span className="metric-icon update-icon"><Activity size={17} /></span><span className="metric-label">DATA FRESHNESS</span><b>{observation.observedAt ? timeAgo(observation.observedAt) : "No reading"}</b><small>{observation.freshnessStatus === "delayed" ? "Source monitor update is delayed" : loading ? "Checking for a new update…" : `Refreshed ${lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</small></article><article className="metric-card response-card"><span className="metric-icon response-icon"><HeartPulse size={17} /></span><span className="metric-label">SCHOOL RESPONSE</span><b>{alertsEnabled ? "Alert ready" : "Action card active"}</b><small>{Object.values(actionChecks).filter(Boolean).length} of {responseActions.length} actions checked today</small></article></div>

        <section className="message-studio" aria-labelledby="message-title">
          <div className="message-studio-head"><div className="message-heading-icon"><MessageCircle size={17} /></div><div className="message-heading-copy"><span className="tiny-label">PRINCIPAL’S COMMUNICATION DESK</span><h2 id="message-title">Keep families in the loop</h2><p>Turn the school air brief into a calm, ready-to-share update.</p></div><span className={`message-role ${isPrincipal ? "message-role-approved" : ""}`}>{isPrincipal ? "PRINCIPAL PREVIEW" : "DRAFT · PRINCIPAL REVIEW"}</span></div>
          <div className="message-controls"><label htmlFor="message-audience">SEND TO</label><select id="message-audience" value={messageAudience} onChange={(event) => { setMessageAudience(event.target.value); setMessageDraft(null); setMessageStatus(""); }}><option>Parents and guardians</option><option>Class parent groups</option><option>Teaching staff</option><option>All school groups</option></select><button className="message-refresh" onClick={() => { setMessageDraft(suggestedMessage); setMessageStatus("Draft refreshed with the current school air brief."); }}><RefreshCw size={13} /> Refresh draft</button></div>
          <textarea className="message-draft" aria-label="Editable message for parents or school groups" value={currentMessage} onChange={(event) => setMessageDraft(event.target.value)} rows={7} />
          <div className="message-studio-foot"><p><ShieldCheck size={14} /> Review the reading and school action before sharing. SaansSetu does not send messages or add families to groups.</p><div className="message-actions"><button className="message-copy" onClick={copyParentMessage}><Copy size={14} /> Copy message</button><button className="message-share" onClick={shareParentMessage}><Share2 size={14} /> {isPrincipal ? "Share to channel" : "Principal share"}</button></div></div>
          {messageStatus && <div className="message-status" role="status">{messageStatus}</div>}
        </section>

        <div className="lower-grid"><section className="trend-card"><div className="lower-heading"><div><span className="tiny-label">TODAY AT THE NEAREST STATION</span><h3>Air quality through the day</h3></div><span className={`category-pill ${policy.color}`}>{observation.category}</span></div><div className="trend-chart" aria-label="Recent AQI readings trend"><div className="chart-guides"><span>400</span><span>300</span><span>200</span><span>100</span><span>0</span></div><svg viewBox="0 0 540 155" role="img" aria-label="AQI trend for the nearest monitoring station"><defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>{observation.trend.length > 1 ? <><path className="chart-area" d={makeArea(observation.trend)} /><path className="chart-line" d={makeLine(observation.trend)} />{observation.trend.map((value, index) => <circle key={`${index}-${value}`} cx={30 + index * (480 / (observation.trend.length - 1))} cy={145 - value / 500 * 132} r={index === observation.trend.length - 1 ? 4 : 2.3} />)}</> : <text className="trend-empty-label" x="270" y="78" textAnchor="middle">Building eligible station history…</text>}</svg></div><div className="chart-times"><span>−7h</span><span>−6h</span><span>−5h</span><span>−4h</span><span>−3h</span><span>NOW</span></div><div className="trend-source"><span className="source-icon">i</span><span>{observation.source} · Monitor trend, not school-gate sensor data.</span><button onClick={() => { setLoading(true); getAirSnapshot(selectedSchool, new AbortController().signal).then((result) => { applySnapshot(result); setError(""); }).catch((reason) => { setError(reason.message); setSourceState("unavailable"); }).finally(() => setLoading(false)); }}>Refresh <ArrowRight size={13} /></button></div></section>
          <section className="protocol-card"><div className="protocol-top"><span className="protocol-emblem"><ShieldCheck size={18} /></span><span className="tiny-label">SCHOOL RESPONSE LOG</span><span className="protocol-source">TODAY · {Object.values(actionChecks).filter(Boolean).length}/{responseActions.length}</span></div><h3>Turn the reading<br /><em>into a school plan.</em></h3><div className="protocol-steps response-checklist">{responseActions.map((step, index) => <label className={`protocol-step ${actionChecks[index] ? "response-step-done" : ""}`} key={step}><input type="checkbox" checked={Boolean(actionChecks[index])} onChange={() => toggleResponseAction(index)} /><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p><Check size={14} /></label>)}</div><p className="action-log-note">Saved on this device for today. No student information is collected.</p><a href="https://ncdc.mohfw.gov.in/wp-content/uploads/2025/04/Updated-Draft-Health-Advisory-on-Air-Pollution-under-NPCCHH_latest-version_15-04-2025.pdf" target="_blank" rel="noreferrer">Read school health advisory <ExternalLink size={13} /></a></section></div>
        <section className="agent-panel" aria-labelledby="agent-title">
          <div className="agent-header">
            <div className="agent-icon"><Bot size={18} /><Zap size={14} className="zap" /></div>
            <div className="agent-title"><span className="tiny-label">AI AGENT · LOCAL</span><h3 id="agent-title">SaansSetu Agent</h3><p>Automates: location → AQI fetch → action plan → parent message</p></div>
            <span className="agent-status">LOCAL ONLY</span>
          </div>
          <AgentPanel
            selectedSchool={selectedSchool}
            observation={observation}
            isPrincipal={isPrincipal}
            messageAudience={messageAudience}
            onMessageUpdate={setMessageDraft}
            onStatus={setNotice}
          />
        </section>

        <footer className="school-footer"><span><ShieldCheck size={14} /> Public monitor data can lag or contain anomalies. Verify before issuing school closure or emergency instructions.</span><span>Source: CPCB via Open Government Data Platform</span></footer>
      </main>
    </div>
    {notice && <div className="notice-toast"><Check size={15} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}
  </div>;
}

function AgentPanel({ selectedSchool, observation, isPrincipal, messageAudience, onMessageUpdate, onStatus }) {
  const [agentState, setAgentState] = useState("idle");
  const [agentResult, setAgentResult] = useState(null);
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const runAgent = async () => {
    if (!query.trim()) return;
    setIsRunning(true);
    setAgentState("running");
    onStatus("Agent started: geocoding → AQI → drafting message...");

    try {
      const result = await agent.runFullCycle(query, messageAudience, isPrincipal ? "school_admin" : "educator");
      setAgentResult(result);
      if (result) {
        setAgentState("complete");
        onStatus(`Agent complete: ${result.school.name} — AQI ${result.observation?.aqi ?? "N/A"}`);
        if (result.message) onMessageUpdate(result.message);
      } else {
        setAgentState("error");
        onStatus("Agent: No results found");
      }
    } catch (e) {
      setAgentState("error");
      onStatus(`Agent error: ${e.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const triggerIngestion = async () => {
    onStatus("Triggering manual AQI ingestion...");
    const result = await agent.triggerIngestion();
    onStatus(result.ingestedStations ? `Ingested ${result.ingestedStations} stations` : `Ingestion failed: ${result.error}`);
  };

  if (agentState === "idle" && !agentResult) {
    return (
      <div className="agent-idle">
        <p className="agent-prompt">Enter a school name or area to run the full agent cycle:</p>
        <div className="agent-input-row">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g., Riverstone Public School, Delhi"
            onKeyDown={e => e.key === "Enter" && runAgent()}
          />
          <button className="agent-run-btn" onClick={runAgent} disabled={isRunning || !query.trim()}>
            <Zap size={14} /> Run Agent
          </button>
        </div>
        <div className="agent-actions">
          <button onClick={triggerIngestion}><RefreshCw size={13} /> Trigger AQI Ingestion</button>
          <span className="agent-hint">Runs locally · No external LLM · Uses CPCB data.gov.in</span>
        </div>
      </div>
    );
  }

  if (agentState === "running") {
    return (
      <div className="agent-running">
        <div className="agent-spinner" />
        <p>Agent working: geocoding school → fetching live AQI → drafting message...</p>
      </div>
    );
  }

  if (agentState === "error") {
    return (
      <div className="agent-error">
        <p>Agent encountered an issue. Try a different school name or check backend connection.</p>
        <button onClick={() => setAgentState("idle")}><X size={14} /> Reset</button>
      </div>
    );
  }

  const { school, observation: obs, message, checklist } = agentResult;
  const cat = obs ? (obs.aqi <= 50 ? "good" : obs.aqi <= 100 ? "satisfactory" : obs.aqi <= 200 ? "moderate" : obs.aqi <= 300 ? "poor" : obs.aqi <= 400 ? "very-poor" : "severe") : "moderate";

  return (
    <div className="agent-result">
      <div className="agent-result-header">
        <div className={`agent-aqi-badge ${cat}`}>{obs?.aqi ?? "—"}</div>
        <div>
          <strong>{school?.name}</strong>
          <small>{school?.city}, {school?.state}</small>
        </div>
        <span className={`agent-category ${cat}`}>{obs?.category ?? "Awaiting data"}</span>
      </div>

      <div className="agent-checklist">
        <h4>Auto-generated Action Checklist</h4>
        {checklist?.map(item => (
          <label key={item.id} className="agent-check-item">
            <input type="checkbox" defaultChecked={item.done} />
            <span>{item.text}</span>
          </label>
        ))}
      </div>

      <div className="agent-message-preview">
        <h4>Generated Message ({isPrincipal ? "Principal" : "Draft for Review"})</h4>
        <textarea readOnly value={message} rows={6} />
        <div className="agent-message-actions">
          <button onClick={() => onMessageUpdate(message)}>Use this message</button>
          <button onClick={() => { setAgentState("idle"); setAgentResult(null); setQuery(""); }}>Run again</button>
        </div>
      </div>
    </div>
  );
}

function makeLine(values) {
  const step = values.length > 1 ? 480 / (values.length - 1) : 0;
  return values.map((value, index) => `${index ? "L" : "M"} ${30 + index * step} ${145 - value / 500 * 132}`).join(" ");
}

function makeArea(values) {
  const end = 30 + Math.max(values.length - 1, 0) * (values.length > 1 ? 480 / (values.length - 1) : 0);
  return `${makeLine(values)} L ${end} 150 L 30 150 Z`;
}

export default App;
