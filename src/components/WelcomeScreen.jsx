import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, BookOpenCheck, HeartPulse, ShieldCheck, Wind } from "lucide-react";

function AqiBackdrop() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles = Array.from({ length: 82 }, () => ({ x: Math.random(), y: Math.random(), radius: Math.random() * 2 + .4, speed: Math.random() * .00045 + .00012, phase: Math.random() * Math.PI * 2 }));
    let frame;
    let width = 0;
    let height = 0;
    const resize = () => { width = canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 1.6); height = canvas.clientHeight * Math.min(window.devicePixelRatio || 1, 1.6); canvas.width = width; canvas.height = height; };
    resize();
    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.6);
      const sunX = width * .73;
      const sunY = height * .31;
      const radius = Math.min(width, height) * .21;
      const halo = context.createRadialGradient(sunX, sunY, radius * .08, sunX, sunY, radius * 2.5);
      halo.addColorStop(0, "rgba(255, 202, 111, .38)"); halo.addColorStop(.4, "rgba(239, 151, 89, .15)"); halo.addColorStop(1, "rgba(208, 124, 85, 0)");
      context.fillStyle = halo; context.fillRect(0, 0, width, height);
      const haze = context.createLinearGradient(0, height * .45, 0, height);
      haze.addColorStop(0, "rgba(235, 177, 131, .02)"); haze.addColorStop(.48, "rgba(207, 143, 109, .21)"); haze.addColorStop(1, "rgba(59, 55, 52, .9)");
      context.fillStyle = haze; context.fillRect(0, height * .35, width, height * .65);
      particles.forEach((particle, index) => {
        if (!reduced) { particle.y -= particle.speed * ratio * (time % 4000 < 2000 ? 1 : .68); particle.x += Math.sin(time * .00018 + particle.phase) * .00012; if (particle.y < .08) { particle.y = .95 + Math.random() * .1; particle.x = Math.random(); } }
        const x = particle.x * width; const y = particle.y * height;
        const flicker = .35 + (Math.sin(time * .001 + particle.phase) + 1) * .18;
        context.beginPath(); context.arc(x, y, particle.radius * ratio, 0, Math.PI * 2);
        context.fillStyle = index % 5 === 0 ? `rgba(255, 217, 159, ${flicker})` : `rgba(230, 198, 161, ${flicker * .55})`;
        context.fill();
      });
      if (!reduced) frame = window.requestAnimationFrame(draw);
    };
    draw();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <canvas ref={canvasRef} className="aqi-atmosphere" aria-hidden="true" />;
}

export default function WelcomeScreen({ onLogin, onStart, onDemo }) {
  const [showDemoRoles, setShowDemoRoles] = useState(false);
  function useDemo(role) {
    const personas = {
      educator: { email: "educator@demo-school.in", name: "Riya Sharma", role: "educator", roleLabel: "Educator · sample" },
      school_admin: { email: "principal@demo-school.in", name: "Aarohi Mehta", role: "school_admin", roleLabel: "School admin · sample" },
      district_officer: { email: "district@demo-school.in", name: "Anil Kumar", role: "district_officer", roleLabel: "District officer · sample" },
    };
    const session = { mode: "demo", schoolName: "Riverstone Public School", ...personas[role] };
    sessionStorage.setItem("saanssetu.session", JSON.stringify(session));
    onDemo(session);
  }
  return <main className="aqi-welcome">
    <div className="welcome-backdrop"><AqiBackdrop /><div className="city-silhouette" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><span className="school-roof" /></div><div className="ambient-lines" /></div>
    <header className="welcome-nav"><a className="welcome-logo" href="#home"><span><Wind size={20} /></span><b>SaansSetu</b><small>SCHOOLS · INDIA</small></a><div className="welcome-nav-right"><span className="welcome-proof"><ShieldCheck size={14} /> STATION CONTEXT · SCHOOL ACTIONS · FAMILY UPDATES</span><button className="nav-login" onClick={onLogin}>Log in</button><button className="nav-signup" onClick={onStart}>Create school account <ArrowRight size={15} /></button></div></header>
    <section className="welcome-hero" id="home"><div className="hero-copy"><div className="hero-eyebrow"><span /> AIR UPDATES FOR INDIA’S SCHOOLS</div><h1>When the air changes,<br />schools need to know<br /><em>what to do next.</em></h1><p>Principals receive AQI numbers without enough local context or a clear way to act on them. SaansSetu shows the nearest monitor and how fresh its reading is, helps schools choose a response, and prepares a clear update for families.</p><div className="hero-actions"><button className="hero-start" onClick={onStart}>Create a school account <span><ArrowRight size={18} /></span></button><div className="hero-demo-wrap"><button className="hero-demo" onClick={() => setShowDemoRoles((open) => !open)}>Explore sample role views <ArrowDown size={15} /></button>{showDemoRoles && <div className="demo-role-menu" aria-label="Choose a sample role"><span>SAMPLE WORKSPACES · NOT SECURE ACCOUNTS</span><button onClick={() => useDemo("educator")}>Educator <small>See the school brief and prepare a draft</small></button><button onClick={() => useDemo("school_admin")}>School administrator <small>Review family messages and school actions</small></button><button onClick={() => useDemo("district_officer")}>District officer <small>See the sample school network view</small></button></div>}</div></div><div className="hero-data-note"><ShieldCheck size={15} /><span>Every reading shows its source, distance and update time. A nearby monitor is not a sensor on campus.</span></div></div>
      <div className="hero-monitor"><div className="monitor-orbit orbit-a" /><div className="monitor-orbit orbit-b" /><div className="monitor-label"><span className="monitor-live" /> SAMPLE SCHOOL READING</div><div className="monitor-number">286</div><div className="monitor-category">POOR <span>·</span> AQI</div><div className="monitor-divider" /><div className="monitor-plan"><span>FOR THE SCHOOL DAY</span><b>Move physical activity indoors.</b><small>Nearest monitor · 2.7 km · 18 min ago</small></div><div className="monitor-window">SAMPLE VIEW · NOT A LIVE READING</div></div>
      <div className="hero-side-note"><span className="side-note-rule" /><span>THE AIR<br />OUTSIDE IS<br /><em>part of the<br />school day.</em></span></div>
    </section>
    <section className="welcome-features"><div className="feature-intro"><span>NOT ANOTHER AQI MAP</span><p>A school-ready response, grounded in the reading.</p></div><div className="welcome-feature"><span className="feature-icon"><BookOpenCheck size={19} /></span><div><b>Action guidance</b><small>School prompts based on published child health advisories.</small></div></div><div className="welcome-feature"><span className="feature-icon feature-data"><Wind size={19} /></span><div><b>Source transparency</b><small>Station, distance, freshness and missing-data cues.</small></div></div><div className="welcome-feature"><span className="feature-icon feature-care"><HeartPulse size={19} /></span><div><b>Built for school teams</b><small>Separate views for educators, school admins and districts.</small></div></div></section>
    <footer className="welcome-bottom"><span>Air readings from public monitoring stations can differ from conditions at a school site.</span><span>Ambient visual generated in-app · no stock footage or watermark</span></footer>
  </main>;
}
