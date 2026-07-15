import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wallet } from 'lucide-react';
import { authFetch } from './auth.js';
import { setActiveSessionId } from './session.js';
import { getSelectedBranch } from './branchStore.js';
import { friendlyErrorMessage } from './posErrorMessages.js';
import POSInput from './components/pos/POSInput.js';
import POSButton from './components/pos/POSButton.js';
import POSLogoutLink from './components/pos/POSLogoutLink.js';

const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3013/api/v2';

// PG-051 shipped BranchSelectScreen as the canonical branch/warehouse picker, and
// RequireBranch (main.tsx) already redirected away from this screen if no branch/warehouse
// is persisted for this device — so it's safe to just read branchStore here, the same way
// POSScreen trusts RequireSession's guarantee for sessionId. This replaces PG-050's original
// inline picker (see git history) per this package's Architecture note on the handoff.
export default function ShiftOpenScreen() {
  const navigate = useNavigate();
  const [selected] = useState(() => getSelectedBranch());
  const [openingCash, setOpeningCash] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit =
    selected !== null &&
    openingCash.trim() !== '' &&
    !isNaN(Number(openingCash)) &&
    Number(openingCash) >= 0;

  async function handleSubmit() {
    if (!canSubmit || !selected) return;
    setLoading(true);
    try {
      const res = await authFetch(`${SALES_API}/pos/sessions/open`, {
        method: 'POST',
        body: JSON.stringify({
          branchId: selected.branchId,
          warehouseId: selected.warehouseId,
          openingCash: Number(openingCash),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new Error(friendlyErrorMessage(err.error, 'Failed to open shift'));
      }
      const body = (await res.json()) as { data: { id: number } };
      setActiveSessionId(body.data.id);
      toast.success('Shift opened');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open shift');
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
          <h1 className="text-xl font-bold text-primary">Open Shift</h1>
          <p className="text-sm text-secondary">
            Declare your opening cash float to start selling.
          </p>
        </div>

        <POSInput
          label="Opening Cash"
          type="number"
          min="0"
          step="0.01"
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
          required
        />

        <POSButton
          size="lg"
          loading={loading}
          disabled={!canSubmit || loading}
          onClick={() => void handleSubmit()}
          className="w-full"
        >
          {loading ? 'Opening…' : 'Open Shift'}
        </POSButton>
      </div>
    </div>
  );
}
