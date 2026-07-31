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
import AccessDeniedScreen from './AccessDeniedScreen.js';
import ShiftOpenScreen from './ShiftOpenScreen.js';
import ShiftCloseScreen from './ShiftCloseScreen.js';
import ShiftSummaryScreen from './ShiftSummaryScreen.js';
import BranchSelectScreen from './BranchSelectScreen.js';
import { getAccessToken, hasPermission } from './auth.js';
import { PERMISSIONS } from '@erp/types';
import { setActiveSessionId, getActiveSessionId, fetchActiveSession } from './session.js';
import { getSelectedBranch } from './branchStore.js';
import { ThemeProvider, useTheme } from './context/ThemeContext.js';
import TenantThemeSync from './components/pos/TenantThemeSync.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAuth({ children }: { children: ReactElement }) {
  return getAccessToken() ? children : <Navigate to="/login" replace />;
}

// Every real pos-frontend backend route (shift open/close, sales, drawer — see
// apps/sales-service/src/api/pos.routes.ts) now accepts POS_MANAGE (SALES_MANAGER/ADMIN/
// OWNER's broad grant) OR POS_ACCESS (CASHIER's basic till-operator grant), so an
// authenticated user without either can never do anything useful here. Without this guard,
// such a user (e.g. an HR Manager who is a valid ERP login but not till staff) could still
// navigate into any screen and only discover the problem after submitting a form, via a
// raw "Missing permission" toast with no way to sign out from that screen.
// Checked right after RequireAuth so it fires before branch-select/shift-open/etc.
function RequirePermission({ children }: { children: ReactElement }) {
  return hasPermission(PERMISSIONS.POS_MANAGE) || hasPermission(PERMISSIONS.POS_ACCESS) ? (
    children
  ) : (
    <AccessDeniedScreen />
  );
}

// PG-051 — redirects to /branch-select until a branch/warehouse has been persisted for
// this device. Mirrors RequireAuth's/RequireSession's thin-wrapper shape.
function RequireBranch({ children }: { children: ReactElement }) {
  return getSelectedBranch() ? children : <Navigate to="/branch-select" replace />;
}

// PG-050 — redirects a cashier with no open shift to /shift/open before they can reach
// the sale screen. Mirrors RequireAuth's thin-wrapper shape exactly.
//
// A reload while genuinely offline must not strand the cashier: if the server is
// unreachable but this device already has a locally-persisted session id (from an earlier,
// successful check), trust it and let the cashier keep selling through the outage — that's
// the whole point of this app's offline architecture. Only a device with no persisted
// session AND no connectivity has no way to proceed, since /shift/open itself needs the
// network; that state gets a retry screen instead of an indefinite blank one.
function RequireSession({ children }: { children: ReactElement }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'none' | 'offline-unknown'>('checking');

  const check = () => {
    setStatus('checking');
    void fetchActiveSession().then((result) => {
      if (result.status === 'found') {
        setActiveSessionId(result.session.id);
        setStatus('ok');
      } else if (result.status === 'offline') {
        setStatus(getActiveSessionId() !== null ? 'ok' : 'offline-unknown');
      } else {
        setStatus('none');
      }
    });
  };

  useEffect(check, []);

  if (status === 'checking') return null;
  if (status === 'offline-unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-app)] p-4 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Can&apos;t reach the server to confirm your shift status, and this device has no saved
            shift yet. Reconnect and try again.
          </p>
          <button
            type="button"
            onClick={check}
            className="min-h-[44px] rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
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
                  <RequirePermission>
                    <BranchSelectScreen />
                  </RequirePermission>
                </RequireAuth>
              }
            />
            <Route
              path="/shift/open"
              element={
                <RequireAuth>
                  <RequirePermission>
                    <RequireBranch>
                      <ShiftOpenScreen />
                    </RequireBranch>
                  </RequirePermission>
                </RequireAuth>
              }
            />
            <Route
              path="/shift/close"
              element={
                <RequireAuth>
                  <RequirePermission>
                    <RequireBranch>
                      <ShiftCloseScreen />
                    </RequireBranch>
                  </RequirePermission>
                </RequireAuth>
              }
            />
            <Route
              path="/shift/summary"
              element={
                <RequireAuth>
                  <RequirePermission>
                    <RequireBranch>
                      <ShiftSummaryScreen />
                    </RequireBranch>
                  </RequirePermission>
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <RequirePermission>
                    <RequireBranch>
                      <RequireSession>
                        <POSScreen />
                      </RequireSession>
                    </RequireBranch>
                  </RequirePermission>
                </RequireAuth>
              }
            />
            <Route
              path="/lookup"
              element={
                <RequireAuth>
                  <RequirePermission>
                    <RequireBranch>
                      <LookupScreen />
                    </RequireBranch>
                  </RequirePermission>
                </RequireAuth>
              }
            />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <RequirePermission>
                    <RequireBranch>
                      <RequireSession>
                        <POSScreen />
                      </RequireSession>
                    </RequireBranch>
                  </RequirePermission>
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
