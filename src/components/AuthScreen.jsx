import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Wind } from "lucide-react";
import { confirmEmail, hasCognitoConfig, signIn, signUp } from "../services/authService.js";

export default function AuthScreen({ onAuthenticated, onBack }) {
  const [mode, setMode] = useState(window.location.hash === "#signup" ? "signup" : "login");
  const [step, setStep] = useState("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [requestedRole, setRequestedRole] = useState("educator");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const configured = hasCognitoConfig();

  function switchMode(next) { setMode(next); setStep("form"); setError(""); window.history.replaceState(null, "", `#${next}`); }

  async function handleSubmit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (step === "confirm") {
        const session = await confirmEmail({ email, code, password, name, schoolName, requestedRole });
        onAuthenticated(session);
      } else if (mode === "signup") {
        const result = await signUp({ email, password, name, schoolName, requestedRole });
        if (result.confirmationRequired) setStep("confirm");
        else onAuthenticated(result.session);
      } else {
        const session = await signIn({ email, password });
        onAuthenticated(session);
      }
    } catch (reason) { setError(reason.message || "Could not complete that request. Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><div className="auth-atmosphere" /><header className="auth-header"><button className="auth-back" onClick={onBack}><ArrowLeft size={16} /> SaansSetu home</button><a className="auth-brand" href="#home"><span><Wind size={18} /></span><b>SaansSetu</b><small>SCHOOLS · INDIA</small></a></header>
    <section className="auth-wrap"><div className="auth-aside"><span className="auth-eyebrow"><ShieldCheck size={14} /> AIR CONTEXT INTO SCHOOL ACTION</span><h1>One clear<br />brief for your<br /><em>school community.</em></h1><p>See what the nearest monitor reports, choose a practical school response, and prepare a clear update for families.</p><div className="auth-promise"><span>01</span> Source, distance and freshness visible</div><div className="auth-promise"><span>02</span> Principal-reviewed family updates</div><div className="auth-promise"><span>03</span> No student health records collected</div></div>
      <section className="auth-card"><div className="auth-card-head"><span className="auth-icon"><LockKeyhole size={19} /></span><div><span className="auth-eyebrow">{step === "confirm" ? "CHECK YOUR INBOX" : mode === "signup" ? "GET YOUR SCHOOL STARTED" : "WELCOME BACK"}</span><h2>{step === "confirm" ? "Verify your email" : mode === "signup" ? "Create an account" : "Sign in to SaansSetu"}</h2></div></div>
        {!configured && <div className="auth-demo-note"><span>LOCAL PREVIEW</span> AWS Cognito isn’t configured. This form opens a demo session on this device; it does not create a secure account.</div>}
        <form onSubmit={handleSubmit}>
          {step === "confirm" ? <><p className="auth-form-intro">Enter the confirmation code sent to <b>{email}</b>. You will be signed in after verification.</p><label className="auth-field"><span>EMAIL CODE</span><input autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} required placeholder="6 digit code" /></label></> : <>
            {mode === "signup" && <><label className="auth-field"><span>YOUR NAME</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength="2" placeholder="e.g. Aarohi Mehta" /></label><label className="auth-field"><span>SCHOOL NAME</span><input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} required minLength="2" placeholder="e.g. Riverstone Public School" /></label><label className="auth-field"><span>YOUR SCHOOL ROLE</span><select value={requestedRole} onChange={(event) => setRequestedRole(event.target.value)}><option value="educator">Teacher or school staff</option><option value="school_admin">School administrator · requires verification</option></select></label></>}
            <label className="auth-field"><span>WORK EMAIL</span><span className="auth-input"><Mail size={15} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@school.org" /></span></label>
            <label className="auth-field"><span>PASSWORD</span><span className="auth-input"><LockKeyhole size={15} /><input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === "signup" ? 8 : 1} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
          </>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : step === "confirm" ? "Verify and continue" : mode === "signup" ? "Create school account" : "Sign in"}<ArrowRight size={16} /></button>
        </form>
        {step === "form" && <div className="auth-switch">{mode === "signup" ? <>Already have an account? <button onClick={() => switchMode("login")}>Sign in</button></> : <>New to SaansSetu? <button onClick={() => switchMode("signup")}>Create an account</button></>}</div>}
        {mode === "signup" && <p className="auth-role-note"><ShieldCheck size={14} /> District officer access is invitation-only. School administrator requests require verification.</p>}
        {!configured && mode === "login" && <button className="seed-demo" type="button" onClick={() => { setEmail("principal@demo-school.in"); setPassword("demo-preview"); }}>Use the sample school account <ArrowRight size={13} /></button>}
      </section></section>
    <footer className="auth-footer">By continuing, you agree to use station data with its source, distance and freshness context. AQI information supports school decisions; it does not replace district orders or medical advice.</footer>
  </main>;
}
