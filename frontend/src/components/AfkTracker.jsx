import { useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// How often to re-check elapsed idle time against the configured AFK
// timeout — doesn't need to be anywhere near real-time, this just bounds how
// late the logout can fire relative to the actual threshold.
const CHECK_INTERVAL_MS = 10000;

// Any of these firing means the agent is at the keyboard — same rough set
// Settings > "ระบบ"'s afkMinutes field's own docs describe ("ไม่มีการ
// เคลื่อนไหว" = mouse/keyboard/touch, not e.g. a background tab receiving
// socket events, which shouldn't count as "activity").
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'];

// Mounted once inside Layout (so only while actually logged in — see
// App.jsx's PrivateRoute) — watches for browser inactivity and, once it
// crosses the admin-configured afkMinutes threshold, marks this agent
// 'away' (visible to teammates via AgentCard's badge — see Settings.jsx)
// and logs this browser out, same as if the agent had clicked ออกจากระบบ
// themselves. Purely client-side: there's no server-side session to expire,
// this just stops using the locally-stored token, exactly like the normal
// logout button already does.
export default function AfkTracker() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    let afkMs = 0; // 0 = disabled (feature off, or not loaded yet)
    let cancelled = false;

    axios.get('/api/settings/afk-minutes').then(({ data }) => {
      if (!cancelled && data.afkMinutes > 0) afkMs = data.afkMinutes * 60 * 1000;
    }).catch(() => {});

    function markActive() { lastActivityRef.current = Date.now(); }
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      if (!afkMs || firedRef.current) return;
      if (Date.now() - lastActivityRef.current < afkMs) return;
      firedRef.current = true;
      // Best-effort — even if this fails (e.g. the token already expired),
      // still proceed to log out locally; a stale 'online' badge for one
      // agent is a much smaller problem than getting stuck unable to log out.
      axios.patch('/api/agents/me', { status: 'away' }).catch(() => {}).finally(() => {
        logout();
        navigate('/login?reason=afk', { replace: true });
      });
    }, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive));
    };
  }, [logout, navigate]);

  return null;
}
