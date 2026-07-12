import { StrictMode, useState, useEffect, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import './index.css';
import POSScreen from './POSScreen.js';
import LoginScreen from './LoginScreen.js';
import LookupScreen from './LookupScreen.js';
import AccountSuspendedScreen from './AccountSuspendedScreen.js';
import ShiftOpenScreen from './ShiftOpenScreen.js';
import ShiftCloseScreen from './ShiftCloseScreen.js';
import ShiftSummaryScreen from './ShiftSummaryScreen.js';
import BranchSelectScreen from './BranchSelectScreen.js';
import { getAccessToken } from './auth.js';
import { setActiveSessionId, fetchActiveSession } from './session.js';
import { getSelectedBranch } from './branchStore.js';
import { ThemeProvider, useTheme } from './context/ThemeContext.js';
import TenantThemeSync from './components/pos/TenantThemeSync.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAuth({ children }: { children: ReactElement }) {
  return getAccessToken() ? children : <Navigate to="/login" replace />;
}

// PG-051 — redirects to /branch-select until a branch/warehouse has been persisted for
// this device. Mirrors RequireAuth's/RequireSession's thin-wrapper shape.
function RequireBranch({ children }: { children: ReactElement }) {
  return getSelectedBranch() ? children : <Navigate to="/branch-select" replace />;
}

// PG-050 — redirects a cashier with no open shift to /shift/open before they can reach
// the sale screen. Mirrors RequireAuth's thin-wrapper shape exactly.
function RequireSession({ children }: { children: ReactElement }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'none'>('checking');

  useEffect(() => {
    void fetchActiveSession().then((session) => {
      if (session) {
        setActiveSessionId(session.id);
        setStatus('ok');
      } else {
        setStatus('none');
      }
    });
  }, []);

  if (status === 'checking') return null;
  if (status === 'none') return <Navigate to="/shift/open" replace />;
  return children;
}

// react-hot-toast's Toaster doesn't pick up CSS custom properties on its own (it's
// rendered in a portal outside the token cascade context) — style it explicitly per
// theme so toasts don't stay light-on-dark when the app is in dark mode.
function ThemedToaster() {
  const { isDark } = useTheme();
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: isDark ? '#1e293b' : '#ffffff',
          color: isDark ? '#f1f5f9' : '#111827',
          border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}`,
        },
      }}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/account-suspended" element={<AccountSuspendedScreen />} />
            <Route
              path="/branch-select"
              element={
                <RequireAuth>
                  <BranchSelectScreen />
                </RequireAuth>
              }
            />
            <Route
              path="/shift/open"
              element={
                <RequireAuth>
                  <RequireBranch>
                    <ShiftOpenScreen />
                  </RequireBranch>
                </RequireAuth>
              }
            />
            <Route
              path="/shift/close"
              element={
                <RequireAuth>
                  <RequireBranch>
                    <ShiftCloseScreen />
                  </RequireBranch>
                </RequireAuth>
              }
            />
            <Route
              path="/shift/summary"
              element={
                <RequireAuth>
                  <RequireBranch>
                    <ShiftSummaryScreen />
                  </RequireBranch>
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <RequireBranch>
                    <RequireSession>
                      <POSScreen />
                    </RequireSession>
                  </RequireBranch>
                </RequireAuth>
              }
            />
            <Route
              path="/lookup"
              element={
                <RequireAuth>
                  <RequireBranch>
                    <LookupScreen />
                  </RequireBranch>
                </RequireAuth>
              }
            />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <RequireBranch>
                    <RequireSession>
                      <POSScreen />
                    </RequireSession>
                  </RequireBranch>
                </RequireAuth>
              }
            />
          </Routes>
          <ThemedToaster />
          <TenantThemeSync />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
