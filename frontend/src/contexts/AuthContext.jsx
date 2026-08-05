import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
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

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('agent');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setAgent(null);
  }

  return (
    <AuthContext.Provider value={{ token, agent, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
