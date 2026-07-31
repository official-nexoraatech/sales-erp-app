import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePortalAuthStore } from '../store/portalAuth.store.js';

// Entry point for a staff member's "view as this customer" flow: after calling
// POST /admin/impersonate/portal-customer (auth-service), the staff UI opens this app at
// /impersonate-entry?token=<accessToken>. This page never talks to /auth/portal/login — it
// just adopts the already-issued short-lived (1hr) impersonation token, same as any other
// portal session from this app's point of view (requirePortalAuth on the backend doesn't
// distinguish an impersonated session from a real one — see that middleware's own comment).
export function PortalImpersonateEntryPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setSession = usePortalAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Missing impersonation token.');
      return;
    }

    (async () => {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]!)) as {
          tenantId: number;
          customerId: number;
        };
        const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000';
        const response = await fetch(`${gatewayUrl}/api/sales/portal/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Could not load customer profile');
        const body = await response.json();
        setSession(token, {
          id: body.data.id,
          tenantId: payload.tenantId,
          email: body.data.email,
          displayName: body.data.displayName,
          mustResetPassword: false,
        });
        navigate('/', { replace: true });
      } catch {
        setError('This impersonation link is invalid or has expired.');
      }
    })();
  }, [searchParams, navigate, setSession]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-secondary)]">
        {error}
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-secondary)]">
      Loading…
    </div>
  );
}
