const REGION = import.meta.env.VITE_AWS_REGION || import.meta.env.VITE_COGNITO_USER_POOL_ID?.split("_")[0];
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const SESSION_KEY = "sans-setu.session";

export function hasCognitoConfig() { return Boolean(REGION && USER_POOL_ID && CLIENT_ID); }

async function cognito(target, body) {
  const response = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.__type?.split("#").pop()?.replaceAll("_", " ") || "Authentication request failed.");
  return payload;
}

function decodeToken(token) {
  try { return JSON.parse(decodeURIComponent(escape(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))))); } catch { return {}; }
}

function sessionFromAuth(result, fallback = {}) {
  const tokens = result.AuthenticationResult;
  if (!tokens?.IdToken || !tokens?.AccessToken) throw new Error("The identity provider did not return a complete session.");
  const claims = decodeToken(tokens.IdToken);
  const groups = claims["cognito:groups"] || [];
  const role = groups.includes("DistrictOfficer") ? "district_officer" : groups.includes("SchoolAdmin") ? "school_admin" : "educator";
  const requestedRole = claims["custom:requested_role"] || fallback.requestedRole || role;
  const approved = role === "school_admin" || role === "district_officer" || requestedRole !== "school_admin";
  return {
    mode: "cognito", email: claims.email || fallback.email || "", name: claims.name || fallback.name || "School team member", role,
    roleLabel: role === "district_officer" ? "District officer" : role === "school_admin" ? "School admin" : requestedRole === "school_admin" ? "School admin · pending verification" : "Educator",
    schoolName: claims["custom:school_name"] || fallback.schoolName || "Your school",
    requestedRole,
    approved,
    idToken: tokens.IdToken, accessToken: tokens.AccessToken, refreshToken: tokens.RefreshToken,
    expiresAt: Date.now() + (tokens.ExpiresIn || 3600) * 1000,
  };
}

export function getSession() {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null");
    if (session?.mode === "cognito" && session.expiresAt <= Date.now()) { signOut(); return null; }
    return session;
  } catch { return null; }
}

function saveSession(session) {
  try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { throw new Error("This browser cannot store a sign-in session. Enable site storage and try again."); }
  return session;
}

export async function signUp({ email, password, name, schoolName, requestedRole }) {
  if (!hasCognitoConfig()) {
    const session = { mode: "demo", email, name, schoolName, requestedRole, role: "educator", roleLabel: "Educator · demo", approved: requestedRole !== "school_admin" };
    try { localStorage.setItem("saanssetu.demoProfile", JSON.stringify({ email, name, schoolName, requestedRole })); } catch { /* Demo profile is optional. */ }
    return { confirmationRequired: false, session: saveSession(session), demo: true };
  }
  const response = await cognito("SignUp", { ClientId: CLIENT_ID, Username: email, Password: password, UserAttributes: [
    { Name: "email", Value: email }, { Name: "name", Value: name }, { Name: "custom:school_name", Value: schoolName },
  ] });
  return { confirmationRequired: !response.UserConfirmed, email };
}

export async function confirmEmail({ email, code, password, name, schoolName, requestedRole }) {
  if (!hasCognitoConfig()) return signIn({ email, password });
  await cognito("ConfirmSignUp", { ClientId: CLIENT_ID, Username: email, ConfirmationCode: code });
  const result = await cognito("InitiateAuth", { ClientId: CLIENT_ID, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password } });
  return saveSession(sessionFromAuth(result, { email, name, schoolName, requestedRole }));
}

export async function signIn({ email, password }) {
  if (!hasCognitoConfig()) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("saanssetu.demoProfile") || "{}"); } catch { /* Use the default educator demo. */ }
    const isSeedDemo = email.toLowerCase() === "principal@demo-school.in";
    const profile = saved.email?.toLowerCase() === email.toLowerCase() ? saved : isSeedDemo ? { email, name: "Aarohi Mehta", schoolName: "Riverstone Public School", requestedRole: "school_admin" } : { email, name: email.split("@")[0], schoolName: "Sample School", requestedRole: "educator" };
    const principalPreview = isSeedDemo;
    const session = { mode: "demo", ...profile, role: principalPreview ? "school_admin" : "educator", roleLabel: principalPreview ? "School admin · demo preview" : profile.requestedRole === "school_admin" ? "School admin · pending" : "Educator · demo", approved: principalPreview || profile.requestedRole !== "school_admin" };
    return saveSession(session);
  }
  const result = await cognito("InitiateAuth", { ClientId: CLIENT_ID, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password } });
  return saveSession(sessionFromAuth(result, { email }));
}

export function signOut() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* No-op when storage is unavailable. */ }
}
