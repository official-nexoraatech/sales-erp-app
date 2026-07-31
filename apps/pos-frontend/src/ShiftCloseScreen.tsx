import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wallet, AlertTriangle } from 'lucide-react';
import { authFetch } from './auth.js';
import { getActiveSessionId, clearActiveSessionId, type PosSession } from './session.js';
import { friendlyErrorMessage } from './posErrorMessages.js';
import { getPendingSales } from './offlineDb.js';
import { runBackgroundSync } from './swSync.js';
import POSInput from './components/pos/POSInput.js';
import POSButton from './components/pos/POSButton.js';
import POSLogoutLink from './components/pos/POSLogoutLink.js';

// Routed through api-gateway rather than calling sales-service directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';

export default function ShiftCloseScreen() {
  const navigate = useNavigate();
  const sessionId = getActiveSessionId();
  const [session, setSession] = useState<PosSession | null>(null);
  const [closingCash, setClosingCash] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [stuckCount, setStuckCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    void authFetch(`${SALES_API}/pos/sessions/${sessionId}/summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data: PosSession } | null) => setSession(body?.data ?? null));
  }, [sessionId]);

  // Closing a shift with sales still queued offline would compute Expected Cash from the
  // server's totalSales only (which excludes anything not yet synced) and, once the
  // session is CLOSED, those queued sales can never sync afterward (the server rejects
  // with NO_OPEN_SESSION) — a permanent, unreconcilable gap. Refuse to close until the
  // queue is empty, or the cashier has gone back to POS to resolve any stuck items there.
  const refreshPendingCount = useCallback(() => {
    void getPendingSales().then((sales) => {
      setPendingCount(sales.length);
      setStuckCount(sales.filter((s) => s.status === 'stuck').length);
    });
  }, []);

  useEffect(refreshPendingCount, [refreshPendingCount]);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await runBackgroundSync();
      if (result.syncedSales > 0) {
        toast.success(`Synced ${result.syncedSales} pending sale(s)`);
      }
    } finally {
      setSyncing(false);
      refreshPendingCount();
    }
  }

  const runningExpectedCash = session
    ? Number(session.openingCash) + Number(session.totalSales)
    : null;

  const hasPending = (pendingCount ?? 0) > 0;

  const canSubmit =
    closingCash.trim() !== '' &&
    !isNaN(Number(closingCash)) &&
    Number(closingCash) >= 0 &&
    !hasPending;

  async function handleSubmit() {
    if (!sessionId || !canSubmit) return;
    setLoading(true);
    try {
      const res = await authFetch(`${SALES_API}/pos/sessions/${sessionId}/close`, {
        method: 'POST',
        body: JSON.stringify({ closingCash: Number(closingCash) }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new Error(friendlyErrorMessage(err.error, 'Failed to close shift'));
      }
      // The close endpoint only returns { expectedCash, cashVariance } — fetch the full
      // row for ShiftSummaryScreen's recap before the session id is cleared.
      const summaryRes = await authFetch(`${SALES_API}/pos/sessions/${sessionId}/summary`);
      const summaryBody = (await summaryRes.json().catch(() => null)) as {
        data: PosSession;
      } | null;

      clearActiveSessionId();
      toast.success('Shift closed');
      navigate('/shift/summary', { replace: true, state: { session: summaryBody?.data ?? null } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close shift');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page font-sans">
      <POSLogoutLink />
      <div className="bg-surface-card rounded-2xl shadow-token-lg p-8 w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-subtle text-brand">
            <Wallet size={24} />
          </span>
          <h1 className="text-xl font-bold text-primary">End Shift</h1>
          <p className="text-sm text-secondary">Count the cash drawer and enter the total below.</p>
        </div>

        {session && runningExpectedCash !== null && (
          <div className="bg-surface-subtle rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between text-secondary">
              <span>Opening cash</span>
              <span>₹{Number(session.openingCash).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-secondary">
              <span>Sales so far</span>
              <span>₹{Number(session.totalSales).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold text-primary">
              <span>Expected cash</span>
              <span>₹{runningExpectedCash.toFixed(2)}</span>
            </div>
          </div>
        )}

        {hasPending && (
          <div className="rounded-xl border border-warning bg-warning-bg p-3 text-sm space-y-2">
            <div className="flex items-start gap-2 text-warning font-medium">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                {pendingCount} sale{pendingCount === 1 ? '' : 's'} haven&apos;t synced to the server
                yet. Closing now would leave them out of Expected Cash and they can&apos;t sync
                after the shift closes.
              </span>
            </div>
            {stuckCount > 0 && (
              <p className="text-secondary">
                {stuckCount} of these need attention (e.g. a stock conflict) — go back to the till
                to resolve them first.
              </p>
            )}
            {(pendingCount ?? 0) - stuckCount > 0 && (
              <POSButton
                size="sm"
                variant="outline"
                loading={syncing}
                onClick={() => void handleSyncNow()}
              >
                Sync now
              </POSButton>
            )}
            <POSButton size="sm" variant="ghost" onClick={() => navigate('/')}>
              Back to till
            </POSButton>
          </div>
        )}

        <POSInput
          label="Closing Cash Counted"
          type="number"
          min="0"
          step="0.01"
          value={closingCash}
          onChange={(e) => setClosingCash(e.target.value)}
          required
        />

        <POSButton
          size="lg"
          variant="danger"
          loading={loading}
          disabled={!canSubmit || loading}
          onClick={() => void handleSubmit()}
          className="w-full"
        >
          {loading ? 'Closing…' : 'Close Shift'}
        </POSButton>
      </div>
    </div>
  );
}
