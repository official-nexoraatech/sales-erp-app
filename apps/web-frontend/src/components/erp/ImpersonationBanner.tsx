import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/auth.store.js';
import { adminSecurityApi } from '../../api/endpoints.js';
import Button from '../ui/Button.js';

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ImpersonationBanner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const realSession = useAuthStore((s) => s.realSession);
  const expiresAt = useAuthStore((s) => s.impersonationExpiresAt);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!realSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [realSession]);

  const remainingMs = expiresAt ? expiresAt - now : 0;

  useEffect(() => {
    if (!realSession) stoppedRef.current = false;
  }, [realSession]);

  useEffect(() => {
    if (!realSession || !expiresAt || remainingMs > 0 || stoppedRef.current) return;
    stoppedRef.current = true;
    void stop(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, realSession, expiresAt]);

  async function stop(auto: boolean) {
    setStopping(true);
    try {
      await adminSecurityApi.endImpersonation();
    } catch {
      // Best-effort audit-log call — the real session is restored regardless of whether
      // this succeeds (it fails naturally once the impersonation token has already expired).
    }
    useAuthStore.getState().stopImpersonation();
    setStopping(false);
    if (auto) toast('Impersonation session expired — your own session has been restored.');
    // Not '/dashboard' directly — the admin's own role may not have DASHBOARD_VIEW, and '/'
    // already redirects to the first nav item they actually have access to (see IndexRedirect).
    navigate('/');
  }

  if (!realSession || !user) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 bg-amber-500 text-black text-sm font-medium shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert size={16} className="shrink-0" />
        <span className="truncate">
          Impersonating <strong>{user.firstName} {user.lastName}</strong> ({user.email}) — expires in{' '}
          {formatCountdown(remainingMs)}
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={() => { stoppedRef.current = true; void stop(false); }} loading={stopping}>
        Stop impersonating
      </Button>
    </div>
  );
}
