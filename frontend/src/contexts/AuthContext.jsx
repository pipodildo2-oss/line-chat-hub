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
    const t = localStorage.getItem('token');
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
    return t;
  });
  const [agent, setAgent] = useState(() => {
    const s = localStorage.getItem('agent');
    return s ? JSON.parse(s) : null;
  });

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  function login(tokenVal, agentVal) {
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
