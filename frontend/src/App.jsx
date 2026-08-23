import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import Login from './pages/Login';
import Inbox from './pages/Inbox';
import Dashboard from './pages/Dashboard';
import Report from './pages/Report';
import Customers from './pages/Customers';
import Upsell from './pages/Upsell';
import Settings from './pages/Settings';
import Layout from './components/Layout';

function PrivateRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

// Agent role is restricted to Inbox only — Dashboard and Settings are admin-only.
function AdminRoute({ children }) {
  const { agent } = useAuth();
  return agent?.role === 'admin' ? children : <Navigate to="/inbox" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <LanguageProvider>
      <SocketProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route index element={<Navigate to="/inbox" replace />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
              <Route path="report" element={<AdminRoute><Navigate to="/report/audit" replace /></AdminRoute>} />
              <Route path="report/:tab" element={<AdminRoute><Report /></AdminRoute>} />
              <Route path="customers" element={<AdminRoute><Customers /></AdminRoute>} />
              <Route path="upsell" element={<AdminRoute><Upsell /></AdminRoute>} />
              <Route path="settings" element={<AdminRoute><Navigate to="/settings/channels" replace /></AdminRoute>} />
              <Route path="settings/:tab" element={<AdminRoute><Settings /></AdminRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SocketProvider>
      </LanguageProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
