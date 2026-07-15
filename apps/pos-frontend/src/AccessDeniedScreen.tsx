import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { clearTokens } from './auth.js';
import POSButton from './components/pos/POSButton.js';

// Shown by RequirePermission (main.tsx) when an authenticated user's role doesn't hold
// POS_MANAGE — the one permission every real POS backend route is gated on (shift
// open/close, sales, drawer, etc; see apps/sales-service/src/api/pos.routes.ts). Without
// this guard, such a user could still navigate straight into e.g. /shift/open and only find
// out via a raw "Missing permission: POS_MANAGE" toast after filling in the form, with no
// way to sign out from that screen either.
export default function AccessDeniedScreen() {
  const navigate = useNavigate();

  function handleLogout() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page font-sans p-6">
      <div className="bg-surface-card rounded-2xl shadow-token-lg p-8 w-full max-w-sm space-y-5 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-danger/10 text-danger">
            <ShieldAlert size={24} />
          </span>
          <h1 className="text-xl font-bold text-primary">No POS Access</h1>
          <p className="text-sm text-secondary">
            Your account doesn&apos;t have permission to use the till. Ask your manager or admin to
            grant POS access, or sign in with a different account.
          </p>
        </div>

        <POSButton size="lg" variant="secondary" onClick={handleLogout} className="w-full">
          Logout
        </POSButton>
      </div>
    </div>
  );
}
