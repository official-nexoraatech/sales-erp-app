import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { authFetch, getAuthClaims } from './auth.js';
import { setSelectedBranch } from './branchStore.js';
import POSButton from './components/pos/POSButton.js';
import POSCard from './components/pos/POSCard.js';
import POSInput from './components/pos/POSInput.js';
import POSLogoutLink from './components/pos/POSLogoutLink.js';

const TENANT_API = import.meta.env['VITE_TENANT_API_URL'] ?? 'http://localhost:3011/api/v2';
const INVENTORY_API = import.meta.env['VITE_INVENTORY_API_URL'] ?? 'http://localhost:3012/api/v2';

interface Branch {
  id: number;
  name: string;
}
interface Warehouse {
  id: number;
  name: string;
  branchId: number;
}

// PG-051 — the canonical branch/warehouse picker for this device, shown once before a
// cashier reaches the till. Replaces PG-050's inline ShiftOpenScreen picker (see that
// screen's own comment, and this package's Architecture note on the handoff); persists
// the selection via branchStore for ShiftOpenScreen/POSScreen to read.
export default function BranchSelectScreen() {
  const navigate = useNavigate();
  const claims = getAuthClaims();
  const branchIds = claims?.branchIds ?? [];

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [branchId, setBranchId] = useState<number | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehousesLoaded, setWarehousesLoaded] = useState(false);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  // GET /warehouses requires WAREHOUSE_VIEW, which the CASHIER role does not hold by
  // default — mirrors ShiftOpenScreen's pre-existing fallback rather than blocking on a
  // permission this package can't unilaterally grant.
  const [warehouseListFailed, setWarehouseListFailed] = useState(false);
  const [manualWarehouseId, setManualWarehouseId] = useState('');

  useEffect(() => {
    void authFetch(`${TENANT_API}/branches`)
      .then((res) => (res.ok ? res.json() : { data: { content: [] } }))
      .then((body: { data?: { content?: Branch[] } }) => {
        const all = body.data?.content ?? [];
        const scoped = branchIds.length > 0 ? all.filter((b) => branchIds.includes(b.id)) : all;
        setBranches(scoped);
        if (scoped.length === 1) setBranchId(scoped[0]!.id);
        setBranchesLoaded(true);
      })
      .catch(() => setBranchesLoaded(true));
  }, []);

  useEffect(() => {
    if (branchId === null) return;
    setWarehouseId(null);
    setWarehouseListFailed(false);
    setWarehousesLoaded(false);
    void authFetch(`${INVENTORY_API}/warehouses?branchId=${branchId}`)
      .then((res) => {
        if (!res.ok) throw new Error('forbidden');
        return res.json();
      })
      .then((body: { data?: { content?: Warehouse[] } }) => {
        const list = body.data?.content ?? [];
        setWarehouses(list);
        if (list.length === 1) setWarehouseId(list[0]!.id);
        setWarehousesLoaded(true);
      })
      .catch(() => {
        setWarehouses([]);
        setWarehouseListFailed(true);
        setWarehousesLoaded(true);
      });
  }, [branchId]);

  const resolvedWarehouseId = warehouseListFailed
    ? parseInt(manualWarehouseId, 10) || null
    : warehouseId;

  // The fully-silent path: exactly one accessible branch and exactly one warehouse for it —
  // persist and move on without ever rendering a picker. This is what the "a single-branch
  // tenant's cashier never sees a picker" acceptance criterion requires, and it also covers
  // the overwhelmingly common single-branch/single-warehouse case. Manual-entry fallback is
  // excluded here (see confirmManualWarehouse) so a half-typed warehouse ID can't fire this.
  useEffect(() => {
    if (
      branchId !== null &&
      warehousesLoaded &&
      !warehouseListFailed &&
      resolvedWarehouseId !== null
    ) {
      setSelectedBranch(branchId, resolvedWarehouseId);
      navigate('/', { replace: true });
    }
  }, [branchId, warehousesLoaded, warehouseListFailed, resolvedWarehouseId, navigate]);

  function confirmManualWarehouse() {
    if (branchId === null || resolvedWarehouseId === null) return;
    setSelectedBranch(branchId, resolvedWarehouseId);
    navigate('/', { replace: true });
  }

  if (!branchesLoaded) return null;

  // Branch step — only rendered when there's a genuine choice to make.
  if (branchId === null && branches.length > 1) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page font-sans p-6">
        <POSLogoutLink />
        <div className="w-full max-w-sm space-y-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-subtle text-brand">
              <Building2 size={24} />
            </span>
            <h1 className="text-xl font-bold text-primary">Select Branch</h1>
            <p className="text-sm text-secondary">
              Choose which location you&apos;re operating this till from.
            </p>
          </div>
          <div className="space-y-2">
            {branches.map((b) => (
              <POSCard
                key={b.id}
                interactive
                role="button"
                tabIndex={0}
                aria-label={`Select branch ${b.name}`}
                onClick={() => setBranchId(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setBranchId(b.id);
                  }
                }}
                className="text-primary font-medium"
              >
                {b.name}
              </POSCard>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (branchId === null) return null; // no accessible branch resolved yet (or none at all)

  // Warehouse step — only rendered once the branch's warehouse(s) are known and didn't
  // auto-resolve to exactly one. The manual-entry fallback stays rendered even once a
  // valid number has been typed (resolvedWarehouseId non-null) since that path requires an
  // explicit Continue click rather than the auto-navigate effect above.
  if (warehousesLoaded && (warehouseListFailed || resolvedWarehouseId === null)) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page font-sans p-6">
        <POSLogoutLink />
        <div className="bg-surface-card rounded-2xl shadow-token-lg p-8 w-full max-w-sm space-y-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-subtle text-brand">
              <Building2 size={24} />
            </span>
            <h1 className="text-xl font-bold text-primary">Select Warehouse</h1>
          </div>

          {!warehouseListFailed && (
            <div className="flex flex-col gap-1">
              <label htmlFor="branch-select-warehouse" className="text-sm font-medium text-primary">
                Warehouse
              </label>
              <select
                id="branch-select-warehouse"
                value={warehouseId ?? ''}
                onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}
                className="w-full min-h-[44px] px-3 py-2 text-base rounded-xl border border-default bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
              >
                <option value="">Select a warehouse…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {warehouseListFailed && (
            <>
              <POSInput
                label="Warehouse ID"
                type="number"
                value={manualWarehouseId}
                onChange={(e) => setManualWarehouseId(e.target.value)}
                hint="Ask your manager for this till's warehouse ID"
                required
              />
              <POSButton
                size="lg"
                disabled={!manualWarehouseId.trim() || isNaN(parseInt(manualWarehouseId, 10))}
                onClick={confirmManualWarehouse}
                className="w-full"
              >
                Continue
              </POSButton>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}
