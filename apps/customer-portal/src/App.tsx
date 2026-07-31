import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { usePortalAuthStore } from './store/portalAuth.store.js';
import { performPortalRefresh } from './api/portalApiClient.js';
import { PortalLayout } from './layout/PortalLayout.js';
import { PortalLoginPage } from './pages/PortalLoginPage.js';
import { PortalSetPasswordPage } from './pages/PortalSetPasswordPage.js';
import { PortalImpersonateEntryPage } from './pages/PortalImpersonateEntryPage.js';
import { PortalDashboardPage } from './pages/PortalDashboardPage.js';
import { PortalOrderDetailPage } from './pages/PortalOrderDetailPage.js';
import { PortalTicketsPage } from './pages/PortalTicketsPage.js';
import { PortalTicketDetailPage } from './pages/PortalTicketDetailPage.js';
import { PortalLoyaltyPage } from './pages/PortalLoyaltyPage.js';
import { PortalReferralPage } from './pages/PortalReferralPage.js';
import { PortalPreferencesPage } from './pages/PortalPreferencesPage.js';

// Mirrors web-frontend's AuthBootstrap (App.tsx) — silently re-derives the in-memory access
// token from the httpOnly portal_refresh_token cookie on every mount, since the token itself
// is never persisted to localStorage. `customer` (rehydrated from localStorage) tells us
// whether it's even worth trying before the first paint.
function AuthBootstrap({ children }: { children: React.ReactNode }): React.ReactElement {
  const customer = usePortalAuthStore((s) => s.customer);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!customer) {
      setReady(true);
      return;
    }
    // Only re-run if the rehydrated customer identity itself changes, not on every render.
    void performPortalRefresh().finally(() => setReady(true));
  }, [customer?.id]);

  if (!ready)
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading…
      </div>
    );
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  const customer = usePortalAuthStore((s) => s.customer);
  const accessToken = usePortalAuthStore((s) => s.accessToken);
  if (!customer || !accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App(): React.ReactElement {
  return (
    <AuthBootstrap>
      <Routes>
        <Route path="/login" element={<PortalLoginPage />} />
        <Route path="/set-password" element={<PortalSetPasswordPage />} />
        <Route path="/impersonate-entry" element={<PortalImpersonateEntryPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <PortalLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<PortalDashboardPage />} />
          <Route path="orders/:id" element={<PortalOrderDetailPage />} />
          <Route path="tickets" element={<PortalTicketsPage />} />
          <Route path="tickets/:id" element={<PortalTicketDetailPage />} />
          <Route path="loyalty" element={<PortalLoyaltyPage />} />
          <Route path="referral" element={<PortalReferralPage />} />
          <Route path="preferences" element={<PortalPreferencesPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthBootstrap>
  );
}
