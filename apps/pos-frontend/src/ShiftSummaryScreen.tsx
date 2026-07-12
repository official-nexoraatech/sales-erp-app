import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { clearTokens } from './auth.js';
import type { PosSession } from './session.js';
import POSCard from './components/pos/POSCard.js';
import POSButton from './components/pos/POSButton.js';

function money(v: string | null): string {
  return v === null ? '—' : `₹${Number(v).toFixed(2)}`;
}

export default function ShiftSummaryScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = (location.state as { session?: PosSession | null } | null)?.session ?? null;

  function handleLogout() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page font-sans p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-success/10 text-success">
            <CheckCircle2 size={24} />
          </span>
          <h1 className="text-xl font-bold text-primary">Shift Closed</h1>
        </div>

        {session ? (
          <POSCard padding="lg" className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Session</span>
              <span className="font-medium text-primary">{session.sessionNumber}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Opened</span>
              <span className="text-primary">{new Date(session.openedAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Closed</span>
              <span className="text-primary">
                {session.closedAt ? new Date(session.closedAt).toLocaleString() : '—'}
              </span>
            </div>
            <hr className="border-default" />
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Total transactions</span>
              <span className="text-primary">{session.totalTransactions}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Total sales</span>
              <span className="text-primary">{money(session.totalSales)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Expected cash</span>
              <span className="text-primary">{money(session.expectedCash)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Closing cash counted</span>
              <span className="text-primary">{money(session.closingCash)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span className="text-primary">Cash variance</span>
              <span
                className={
                  Number(session.cashVariance) === 0
                    ? 'text-success'
                    : Number(session.cashVariance)! < 0
                      ? 'text-danger'
                      : 'text-warning'
                }
              >
                {money(session.cashVariance)}
              </span>
            </div>
          </POSCard>
        ) : (
          <p className="text-sm text-disabled text-center">
            Shift summary is unavailable — the session details weren't passed through.
          </p>
        )}

        <div className="flex gap-3">
          <POSButton variant="secondary" size="lg" onClick={handleLogout} className="flex-1">
            Logout
          </POSButton>
          <POSButton
            size="lg"
            onClick={() => navigate('/shift/open', { replace: true })}
            className="flex-1"
          >
            Start New Shift
          </POSButton>
        </div>
      </div>
    </div>
  );
}
