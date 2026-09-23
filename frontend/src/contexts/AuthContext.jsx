import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Set the axios auth header synchronously during state init (not in a useEffect).
  // Effects fire child-before-parent on mount, so on a hard refresh a deep child
  // (e.g. Inbox's "load conversations" effect) could otherwise run its first API
  // call before this provider's effect had a chance to attach the header —
  // causing a silent 401 and an empty inbox until the token got set some other way.
  const [token, setToken] = useState(() => {
    // Same "undefined" got written here alongside 'agent' by the same bug —
    // guard this one too so a poisoned browser doesn't keep sending literal
    // "Bearer undefined" on every request after 'agent' has already
    // recovered.
    let t = localStorage.getItem('token');
    if (t === 'undefined' || t === 'null') { localStorage.removeItem('token'); t = null; }
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
    return t;
  });
  const [agent, setAgent] = useState(() => {
    const s = localStorage.getItem('agent');
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      // A bug once wrote the literal string "undefined" here (see login()
      // below) — JSON.parse threw on every single page load from then on,
      // including this one, so the app never got past this line to render
      // anything, on ANY route, for anyone whose browser held that value.
      // Treating unparseable stored state as "not logged in" and clearing
      // it lets a browser stuck like that recover on its own the next time
      // this loads, instead of needing someone to manually clear storage.
      localStorage.removeItem('agent');
      return null;
    }
  });

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  function login(tokenVal, agentVal) {
    // Refuse to persist a broken login rather than silently corrupting
    // storage with it — see the recovery comments above on the incident
    // this guards against. A caller passing bad values here is itself the
    // bug to go fix, not something this function should paper over, so it
    // throws instead of quietly no-op'ing.
    if (!tokenVal || !agentVal) {
      throw new Error('login() called without a real token/agent — refusing to store it');
    }
    localStorage.setItem('token', tokenVal);
    localStorage.setItem('agent', JSON.stringify(agentVal));
    axios.defaults.headers.common['Authorization'] = `Bearer ${tokenVal}`;
    setToken(tokenVal);
    setAgent(agentVal);
  }

  function updateAgent(partial) {
    setAgent(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem('agent', JSON.stringify(next));
      return next;
    });
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('agent');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setAgent(null);
  }

  // If the token expires (7 days) or is otherwise rejected, API calls start
  // failing with 401 but the UI would just look broken with no clear reason.
  // Force a clean logout + redirect so the agent immediately sees the login screen.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      (err) => {
        const isLoginRequest = err.config?.url?.includes('/api/auth/login');
        if (err.response?.status === 401 && !isLoginRequest) {
          logout();
          if (window.location.pathname !== '/login') window.location.href = '/login';
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, []);

  return (
    <AuthContext.Provider value={{ token, agent, login, logout, updateAgent }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
