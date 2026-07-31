import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  ShoppingBag,
  History,
  ArrowLeftRight,
  Search as SearchIcon,
  LayoutGrid,
  Sun,
  Moon,
  UserPlus,
  Check,
  X as XIcon,
  Trash2,
  RefreshCw,
  PackageCheck,
  LogOut,
  DoorOpen,
} from 'lucide-react';
import {
  queueSale,
  getPendingSales,
  deletePendingSale,
  incrementRetries,
  queueCustomer,
  getPendingCustomers,
  deletePendingCustomer,
  incrementCustomerRetries,
  rewritePendingSalesCustomerId,
  resetStuckSale,
  resetStuckCustomer,
  markStockConflict,
  resolveConflict,
} from './offlineDb.js';
import { authFetch, ensureFreshToken, getAuthClaims, hasPermission } from './auth.js';
import { PERMISSIONS } from '@erp/types';
import { getActiveSessionId } from './session.js';
import { getSelectedBranch } from './branchStore.js';
import { getCachedSellerStateCode, refreshCachedSellerStateCode } from './orgStore.js';
import { syncAllReferenceData } from './referenceSync.js';
import { buildDrawerKickOnly } from './escpos.js';
import { supportsAnyPrinting, writeToPairedPrinter, reconnectPairedPrinter } from './webPrinter.js';
import {
  getAllHeldSales,
  getHeldSaleById,
  upsertHeldSale,
  deleteHeldSale,
  getAllCustomers,
  getCustomerById,
  deleteCustomerById,
  upsertCustomers,
  getSyncMeta,
  setSyncMeta,
  getCatalogItemByBarcode,
} from './localStore.js';
import { PENDING_SYNC_META_STORE } from './swSync.js';
import type { CachedCustomer, PendingSale } from './db.js';
import { SyncStatusPanel } from './components/pos/SyncStatusPanel.js';
import { StockConflictModal } from './components/pos/StockConflictModal.js';
import { ReceiptOverlay } from './components/pos/ReceiptOverlay.js';
import { POSOmnibox } from './components/pos/POSOmnibox.js';
import { POSItemLookupModal } from './components/pos/POSItemLookupModal.js';
import { useCart } from './hooks/useCart.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { isValidBarcodeChecksum } from './hooks/useBarcodeScanDetector.js';
import { POSProductCard } from './components/pos/POSProductCard.js';
import POSInput from './components/pos/POSInput.js';
import POSButton from './components/pos/POSButton.js';
import { POSCart } from './components/pos/POSCart.js';
import { POSSummary } from './components/pos/POSSummary.js';
import { POSPaymentPanel, LOYALTY_POINT_VALUE } from './components/pos/POSPaymentPanel.js';
import POSDialog from './components/pos/POSDialog.js';
import { useTheme } from './context/ThemeContext.js';
import { Kbd } from '@erp/ui';
import type { CartItem, POSItem, Customer, CompletedSale } from './components/pos/types.js';
import { friendlySaleErrorMessage, friendlyErrorMessage } from './posErrorMessages.js';

export { SyncStatusPanel } from './components/pos/SyncStatusPanel.js';
export { StockConflictModal } from './components/pos/StockConflictModal.js';

// Routed through api-gateway rather than calling services directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';
const PRODUCTION_API =
  import.meta.env['VITE_PRODUCTION_API_URL'] ?? 'http://localhost:3000/api/production';
// Returns/exchange reuse the full sales-return workflow (approvals, credit notes) already
// built in the main back-office app rather than duplicating that domain logic in POS.
const WEB_FRONTEND_URL = import.meta.env['VITE_WEB_FRONTEND_URL'] ?? 'http://localhost:5173';

// Short WebAudio beep — no asset file needed, degrades silently if audio is blocked.
function playBeep(success: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close();
  } catch {
    // audio unavailable (autoplay policy, no audio device) — the visual flash still gives feedback
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// OFFLINE-06: Background Sync is Chromium/Android-only (no Safari/iOS support) — always
// feature-detect before relying on it. Where unsupported, the existing tab-open triggers
// (window.online listener, manual "Sync now") are the only sync path, unchanged.
export function supportsBackgroundSync(): boolean {
  return 'serviceWorker' in navigator && 'SyncManager' in window;
}

// Registering is safe to call repeatedly (re-registering the same tag is a no-op per spec) —
// called both after queueing an item offline and once at mount, so a device that already has
// leftover pending items from a previous session (which closed before it could register) is
// still covered.
async function registerBackgroundSync(): Promise<void> {
  if (!supportsBackgroundSync()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.sync.register('sync-pending-sales');
  } catch {
    // registration can be denied/unavailable — the tab-open fallback triggers still cover sync
  }
}

export default function POSScreen() {
  const qc = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    cart,
    lastAddedItem,
    highlightedLineItemId,
    grandTotal,
    totalItems,
    totalQuantity,
    subtotal,
    discountAmount,
    taxAmount,
    addItem,
    updateQty,
    updateDiscount,
    applyOrderDiscount,
    undoLastLine,
    moveLineSelection,
    clearCart,
    restoreCart,
  } = useCart();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'CARD' | 'UPI'>('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  // RequireSession (main.tsx) already redirected away from this screen if there's no
  // active session, so it's safe to trust the persisted value once mounted here.
  const [sessionId] = useState(() => getActiveSessionId()!);
  // RequireBranch (main.tsx) already redirected away from this screen if no branch/
  // warehouse is persisted for this device — same trust-the-guard convention as sessionId.
  const [selectedBranch] = useState(() => getSelectedBranch());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [stuckCount, setStuckCount] = useState(0);
  const [conflictSales, setConflictSales] = useState<PendingSale[]>([]);
  const [showConflicts, setShowConflicts] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [scanFlash, setScanFlash] = useState<'success' | 'error' | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastSale, setLastSale] = useState<CompletedSale | null>(null);
  const [orderDiscountPct, setOrderDiscountPct] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRows, setSplitRows] = useState<{ mode: 'CASH' | 'CARD' | 'UPI'; amount: string }[]>([
    { mode: 'CASH', amount: '' },
    { mode: 'CARD', amount: '' },
  ]);
  const [redeemPoints, setRedeemPoints] = useState('');
  // CRM-ROADMAP Phase 2, Feature 3 — a specific catalog reward, mutually exclusive with the
  // raw-points redemption above (a sale applies at most one loyalty redemption).
  const [selectedRewardId, setSelectedRewardId] = useState('');
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showLookup, setShowLookup] = useState(false);
  const [drawerOpening, setDrawerOpening] = useState(false);

  const { data: upiData } = useQuery({
    queryKey: ['pos-upi-vpa'],
    queryFn: async () => {
      const res = await authFetch(`${SALES_API}/pos/upi-vpa`);
      if (!res.ok) return { data: { upiVpa: null, payeeName: 'Store' } };
      return res.json() as Promise<{ data: { upiVpa: string | null; payeeName: string } }>;
    },
    enabled: paymentMode === 'UPI' && showPayment,
    staleTime: 5 * 60_000,
  });

  // CRM-ROADMAP Phase 2, Feature 3 — specific rewards (e.g. "10% Off Voucher") a customer can
  // redeem points for, as an alternative to the raw points->currency input above.
  const { data: catalogData } = useQuery({
    queryKey: ['pos-redemption-catalog'],
    queryFn: async () => {
      const res = await authFetch(`${SALES_API}/loyalty/redemption-catalog`);
      if (!res.ok) return { data: { content: [] } };
      return res.json() as Promise<{
        data: {
          content: Array<{
            id: number;
            name: string;
            pointsCost: number;
            rewardType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT';
            rewardValue: string;
          }>;
        };
      }>;
    },
    enabled: showPayment && !!customer,
    staleTime: 5 * 60_000,
  });
  const rewardCatalog = catalogData?.data?.content ?? [];

  // Compliance audit: salePayload() used to hardcode placeOfSupply/sellerStateCode to '27'
  // (Maharashtra) for every sale — any non-Maharashtra tenant got wrong CGST/SGST-vs-IGST
  // splitting. Periodically refreshes the cached state code (see orgStore.ts) so it stays
  // current; ShiftOpenScreen.tsx also calls this once right after a shift opens, so a
  // brand-new device has it cached before it can ever reach this screen for the first time.
  useQuery({
    queryKey: ['pos-org-gstin'],
    queryFn: refreshCachedSellerStateCode,
    staleTime: 60 * 60_000,
  });
  const upiVpa = (upiData as { data?: { upiVpa: string | null } } | undefined)?.data?.upiVpa;
  const upiPayeeName =
    (upiData as { data?: { payeeName: string } } | undefined)?.data?.payeeName ?? 'Store';

  const refreshPendingCount = useCallback(async () => {
    const [pending, pendingCustomers] = await Promise.all([
      getPendingSales(),
      getPendingCustomers(),
    ]);
    const stuckSales = pending.filter((p) => p.status === 'stuck');
    setPendingCount(
      pending.filter((p) => p.status !== 'stuck').length +
        pendingCustomers.filter((p) => p.status !== 'stuck').length
    );
    // OFFLINE-07: a stock conflict has its own resolution path (adjust/cancel) — it's
    // deliberately excluded from stuckCount/the generic "Retry" button, since blindly
    // resetting and retrying an unresolved conflict would just fail identically again.
    setConflictSales(stuckSales.filter((p) => p.conflict));
    setStuckCount(
      stuckSales.filter((p) => !p.conflict).length +
        pendingCustomers.filter((p) => p.status === 'stuck').length
    );
  }, []);

  // OFFLINE-06: shared with the service worker's background sync via the same syncMeta
  // store/key (swSync.ts), so the UI reflects a sync regardless of which context ran it.
  const refreshLastSyncedAt = useCallback(async () => {
    const meta = await getSyncMeta(PENDING_SYNC_META_STORE);
    setLastSyncedAt(meta?.lastSyncedAt ?? null);
  }, []);

  const syncPending = useCallback(async () => {
    const pending = (await getPendingSales()).filter((p) => p.status !== 'stuck');
    if (!pending.length) return;
    // Refresh once, proactively, before the batch — otherwise every queued item that
    // finds a dead token independently would trigger its own reactive refresh attempt.
    await ensureFreshToken();
    let synced = 0;
    for (const sale of pending) {
      try {
        // operationId travels with the queued item (set once at queue time, not here) so
        // every retry of this same sale carries the same key — the server dedupes on it.
        const res = await authFetch(`${SALES_API}/pos/sales`, {
          method: 'POST',
          body: JSON.stringify({ ...sale.payload, operationId: sale.operationId }),
        });
        if (res.ok) {
          await deletePendingSale(sale.id!);
          synced++;
        } else {
          // OFFLINE-07: a stock conflict is a deterministic business failure the server
          // has already resolved (voiding the orphaned draft on its side) — route it to
          // conflict resolution immediately rather than counting it toward MAX_RETRIES
          // like a transient network/auth failure.
          const body = (await res.json().catch(() => null)) as {
            error?: {
              code?: string;
              details?: { itemId?: number; available?: number; requested?: number };
            };
          } | null;
          if (body?.error?.code === 'INSUFFICIENT_STOCK' && body.error.details) {
            await markStockConflict(sale.id!, {
              itemId: body.error.details.itemId ?? 0,
              available: body.error.details.available ?? 0,
              requested: body.error.details.requested ?? 0,
            });
          } else {
            await incrementRetries(sale.id!);
          }
        }
      } catch {
        // keep in queue, will retry on next reconnect
        await incrementRetries(sale.id!);
      }
    }
    if (synced > 0) {
      toast.success(`Synced ${synced} offline sale(s)`);
      await setSyncMeta({ store: PENDING_SYNC_META_STORE, lastSyncedAt: Date.now() });
      await refreshLastSyncedAt();
    }
    await refreshPendingCount();
  }, [refreshPendingCount, refreshLastSyncedAt]);

  // OFFLINE-05: syncs offline-created customers. Run before syncPending() on reconnect —
  // a queued sale may reference a locally-created customer's negative placeholder id, and
  // rewritePendingSalesCustomerId() below patches that id in the sale queue as soon as the
  // real server id is known, before the sale itself is submitted.
  const syncPendingCustomers = useCallback(async () => {
    const pending = (await getPendingCustomers()).filter((p) => p.status !== 'stuck');
    if (!pending.length) return;
    await ensureFreshToken();
    let synced = 0;
    for (const c of pending) {
      try {
        const res = await authFetch(`${SALES_API}/customers`, {
          method: 'POST',
          body: JSON.stringify({ ...c.payload, operationId: c.operationId }),
        });
        if (res.ok) {
          const body = (await res.json()) as { data: CachedCustomer & { id: number } };
          const real = body.data;
          await deleteCustomerById(c.localCustomerId);
          await upsertCustomers([
            {
              id: real.id,
              tenantId: real.tenantId,
              branchId: real.branchId,
              displayName: real.displayName,
              phone: real.phone,
              ...(real.altPhone !== undefined ? { altPhone: real.altPhone } : {}),
              ...(real.email !== undefined ? { email: real.email } : {}),
              customerType: real.customerType,
              updatedAt:
                typeof real.updatedAt === 'string'
                  ? real.updatedAt
                  : new Date(real.updatedAt).toISOString(),
            },
          ]);
          await rewritePendingSalesCustomerId(c.localCustomerId, real.id);
          setCustomer((cur) =>
            cur && cur.id === c.localCustomerId ? { ...cur, id: real.id } : cur
          );
          await deletePendingCustomer(c.id!);
          synced++;
        } else {
          await incrementCustomerRetries(c.id!);
        }
      } catch {
        await incrementCustomerRetries(c.id!);
      }
    }
    if (synced > 0) {
      toast.success(`Synced ${synced} offline customer(s)`);
      await setSyncMeta({ store: PENDING_SYNC_META_STORE, lastSyncedAt: Date.now() });
      await refreshLastSyncedAt();
    }
    await refreshPendingCount();
  }, [refreshPendingCount, refreshLastSyncedAt]);

  // OFFLINE-06: manual recovery for items the automatic retry loop gave up on (see
  // MAX_RETRIES in offlineDb.ts) — resets them to 'pending' so the next sync attempt
  // includes them again, then immediately tries a sync if online.
  const retryStuckItems = useCallback(async () => {
    const [stuckSales, stuckCustomers] = await Promise.all([
      // OFFLINE-07: conflict items are excluded — they need adjust/cancel resolution,
      // not a blind reset-and-retry (see StockConflictModal below).
      getPendingSales().then((s) => s.filter((p) => p.status === 'stuck' && !p.conflict)),
      getPendingCustomers().then((c) => c.filter((p) => p.status === 'stuck')),
    ]);
    await Promise.all([
      ...stuckSales.map((s) => resetStuckSale(s.id!)),
      ...stuckCustomers.map((c) => resetStuckCustomer(c.id!)),
    ]);
    await refreshPendingCount();
    if (isOnline) void syncPendingCustomers().then(() => syncPending());
  }, [isOnline, refreshPendingCount, syncPending, syncPendingCustomers]);

  // OFFLINE-07: resolves a stock-conflict stuck sale (adjust quantity to what's actually
  // available & retry, or cancel it outright) and immediately attempts a sync so an
  // adjusted sale doesn't just sit pending until the next reconnect/manual sync.
  const handleResolveConflict = useCallback(
    async (id: number, action: 'adjust' | 'cancel') => {
      const outcome = await resolveConflict(id, action);
      if (outcome === 'adjusted') toast.success('Sale adjusted to available stock — retrying');
      else if (outcome === 'cancelled') toast('Sale cancelled', { icon: <Trash2 size={16} /> });
      await refreshPendingCount();
      if (isOnline) void syncPendingCustomers().then(() => syncPending());
    },
    [isOnline, refreshPendingCount, syncPending, syncPendingCustomers]
  );

  useEffect(() => {
    void refreshPendingCount();
    void refreshLastSyncedAt();
    // POSScreen only mounts once authenticated (see main.tsx's RequireAuth), so this
    // doubles as the "on login" trigger — force a full pull even inside the min-interval
    // guard since a fresh device/session has nothing cached yet.
    void syncAllReferenceData(true);
    // Silently reconnects to a previously-paired printer, if any — getDevices()/
    // getPorts() never prompt, so this never surprises the cashier with a permission dialog.
    void reconnectPairedPrinter();

    // Register service worker
    if ('serviceWorker' in navigator) {
      // OFFLINE-06: sw.ts now statically imports swSync.ts, so Vite's build emits sw.js as
      // an ES module (it contains an `import` statement) — { type: 'module' } is required
      // or registration fails outright. Module service workers are Chromium-only (same
      // constraint as Background Sync itself, so this doesn't reduce Background-Sync-relevant
      // coverage), but browsers without support (notably Firefox, which also lacks
      // Background Sync) will get no service worker at all rather than falling back to the
      // old catalog-cache/offline-navigation behavior — verify current browser support
      // before relying on this in production.
      void navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(() => {});
      // OFFLINE-06: re-register on every mount, not just after queueing — covers a device
      // that already has pending items left over from a previous session that closed
      // before it could register.
      void registerBackgroundSync();
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data as {
          type?: string;
          syncedSales?: number;
          syncedCustomers?: number;
        };
        if (data?.type === 'BACKGROUND_SYNC_DONE') {
          void refreshPendingCount();
          void refreshLastSyncedAt();
          const total = (data.syncedSales ?? 0) + (data.syncedCustomers ?? 0);
          if (total > 0)
            toast(`Synced ${total} item(s) in the background`, { icon: <RefreshCw size={16} /> });
        }
      });
    }

    const handleOnline = () => {
      setIsOnline(true);
      // Customers before sales — a queued sale may reference a customer that was also
      // created offline, and its placeholder id needs rewriting before the sale syncs.
      void syncPendingCustomers().then(() => syncPending());
      void syncAllReferenceData();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPending, syncPendingCustomers, refreshPendingCount, refreshLastSyncedAt]);

  // Quick items
  const { data: quickData } = useQuery({
    queryKey: ['pos-quick-items'],
    queryFn: async () => {
      const res = await authFetch(`${SALES_API}/pos/quick-items`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Failed to load quick items');
      }
      return res.json() as Promise<{ data: POSItem[] }>;
    },
  });
  const quickItems: POSItem[] = quickData?.data ?? [];

  // Customer search — OFFLINE-05: always search the local Dexie cache (populated by
  // OFFLINE-04's sync) so this works with zero network dependency, supplemented by a live
  // fetch when online to catch anything not yet synced locally (e.g. created moments ago
  // on another terminal).
  const { data: localCustomerResults } = useQuery({
    queryKey: ['pos-customer-local', customerSearch],
    queryFn: async () => {
      const q = customerSearch.trim().toLowerCase();
      const all = await getAllCustomers();
      return all
        .filter(
          (c) => c.displayName.toLowerCase().includes(q) || c.phone.includes(customerSearch.trim())
        )
        .slice(0, 10);
    },
    enabled: customerSearch.trim().length > 1,
  });
  const { data: liveCustomerData } = useQuery({
    queryKey: ['pos-customer-live', customerSearch],
    queryFn: async () => {
      const res = await authFetch(
        `${SALES_API}/pos/customer-search?q=${encodeURIComponent(customerSearch)}`
      );
      if (!res.ok) return { data: [] };
      return res.json() as Promise<{ data: Customer[] }>;
    },
    enabled: isOnline && customerSearch.trim().length > 1,
  });
  const customerResults: Customer[] = (() => {
    const merged = new Map<number, Customer>();
    for (const c of localCustomerResults ?? [])
      merged.set(c.id, { id: c.id, displayName: c.displayName, phone: c.phone });
    for (const c of (liveCustomerData as { data?: Customer[] } | undefined)?.data ?? [])
      merged.set(c.id, c);
    return Array.from(merged.values());
  })();

  // Focus barcode input on mount
  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  // Redeemed loyalty points reduce the amount actually owed — matches pos.routes.ts's
  // server-authoritative `amountDue = grandTotal - redemptionValue`. Change/UPI/split
  // validation must all be computed against amountDue, not the pre-redemption grandTotal,
  // or a customer paying cash after redeeming points would see the wrong Change amount.
  // A selected catalog reward takes precedence over the raw-points input (mutually exclusive,
  // matching pos.routes.ts's own validation) — this is only a client-side preview of the
  // discount; the server computes and debits the authoritative amount atomically.
  const selectedReward = rewardCatalog.find((r) => String(r.id) === selectedRewardId);
  const redemptionValue = selectedReward
    ? selectedReward.rewardType === 'DISCOUNT_PERCENT'
      ? round2((grandTotal * parseFloat(selectedReward.rewardValue)) / 100)
      : parseFloat(selectedReward.rewardValue)
    : round2((parseInt(redeemPoints, 10) || 0) * LOYALTY_POINT_VALUE);
  const amountDue = round2(Math.max(0, grandTotal - redemptionValue));
  const change = Math.max(0, round2((parseFloat(amountTendered) || 0) - amountDue));

  // Sends just the drawer-kick ESC/POS command to the currently paired printer,
  // pairing on demand if nothing is paired yet — independent of printing a receipt.
  const openDrawer = async () => {
    setDrawerOpening(true);
    try {
      await writeToPairedPrinter(buildDrawerKickOnly());
      toast.success('Drawer opened');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open drawer');
    } finally {
      setDrawerOpening(false);
    }
  };

  const flashFeedback = (kind: 'success' | 'error') => {
    setScanFlash(kind);
    playBeep(kind === 'success');
    setTimeout(() => setScanFlash(null), 300);
  };

  // Resolves a scanned/typed value to an item: instant local match against the quick-items
  // grid first, then production-service's live full-catalog barcode lookup, then (if offline
  // or the live lookup couldn't reach the server) the same locally-synced catalog Dexie
  // already keeps for LookupScreen — without this last fallback, a cashier offline could
  // only ever sell the ~20 quick items even though the full catalog is sitting in Dexie for
  // exactly this purpose.
  const resolveAndAddItem = useCallback(
    async (value: string) => {
      const localMatch = quickItems.find(
        (i) => i.barcode === value || i.name.toLowerCase().includes(value.toLowerCase())
      );
      if (localMatch) {
        addItem(localMatch);
        flashFeedback('success');
        return;
      }

      if (navigator.onLine) {
        try {
          const res = await authFetch(
            `${PRODUCTION_API}/items/by-barcode/${encodeURIComponent(value)}`
          );
          if (res.ok) {
            const json = (await res.json()) as { data?: { item?: POSItem } };
            if (json.data?.item) {
              addItem(json.data.item);
              flashFeedback('success');
              return;
            }
          }
        } catch {
          // network error — fall through to the offline catalog fallback below
        }
      }

      const cached = await getCatalogItemByBarcode(value);
      if (cached) {
        addItem({
          id: cached.id,
          name: cached.name,
          salePrice: String(cached.salePrice),
          gstRate: cached.gstRate,
          cessRate: cached.cessRate,
          ...(cached.barcode ? { barcode: cached.barcode } : {}),
        });
        flashFeedback('success');
        return;
      }

      flashFeedback('error');
      // A checksum-invalid, digit-only value of a real barcode length (EAN-8/12/13/14) is a
      // stronger signal of a garbled/partial scan than "not in our catalog" — a clearer
      // message than the generic not-found toast. Doesn't change whether the lookup was
      // attempted, only which message is shown once it's already failed.
      toast.error(
        isValidBarcodeChecksum(value)
          ? `No item found for "${value}"`
          : `"${value}" doesn't look like a valid barcode — try rescanning`
      );
    },
    [quickItems]
  );

  // Camera-based scanning (tablet/mobile, no barcode scanner hardware) — feeds the same
  // resolveAndAddItem path as a keyboard-wedge scan.
  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    let controls: { stop: () => void } | undefined;

    void reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (stopped || !result) return;
        stopped = true;
        controls?.stop();
        setCameraOpen(false);
        void resolveAndAddItem(result.getText());
      })
      .then((c) => {
        controls = c;
        if (stopped) controls.stop();
      })
      .catch(() => {
        toast.error('Camera unavailable — check browser permissions');
        setCameraOpen(false);
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [cameraOpen, resolveAndAddItem]);

  const salePayload = () => ({
    sessionId,
    customerId: customer?.id,
    branchId: selectedBranch?.branchId ?? 0,
    warehouseId: selectedBranch?.warehouseId ?? 0,
    placeOfSupply: getCachedSellerStateCode() ?? '27',
    sellerStateCode: getCachedSellerStateCode() ?? '27',
    lines: cart.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      gstRate: l.gstRate,
      cessRate: l.cessRate,
      discountPct: l.discountPct,
    })),
    paymentMode,
    amountTendered: parseFloat(amountTendered) || amountDue,
    loyaltyPointsRedeem: selectedReward ? 0 : parseInt(redeemPoints, 10) || 0,
    ...(selectedReward ? { redeemCatalogItemId: selectedReward.id } : {}),
    ...(splitEnabled
      ? {
          payments: splitRows
            .map((r) => ({ mode: r.mode, amount: parseFloat(r.amount) || 0 }))
            .filter((r) => r.amount > 0),
        }
      : {}),
  });

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!isOnline) {
        await queueSale(salePayload());
        void registerBackgroundSync();
        return { queued: true };
      }
      let res: Response;
      try {
        res = await authFetch(`${SALES_API}/pos/sales`, {
          method: 'POST',
          body: JSON.stringify(salePayload()),
        });
      } catch {
        // fetch itself failed (unreachable) — genuine connectivity issue, queue for retry
        await queueSale(salePayload());
        void registerBackgroundSync();
        return { queued: true };
      }
      if (!res.ok) {
        // A completed server response rejecting the sale (stock/credit/price/discount
        // business rules) is not a connectivity problem — retrying the same payload would
        // fail identically, so this must not be silently queued into the offline retry
        // loop. Surface it to the cashier immediately, same as any other online sale.
        const err = (await res.json()) as {
          error?: { code?: string; message?: string; details?: Record<string, unknown> };
        };
        throw new Error(friendlySaleErrorMessage(err.error ?? {}, cart, customer));
      }
      return res.json();
    },
    onSuccess: (result) => {
      const r = result as {
        queued?: boolean;
        data?: { invoiceId: number; invoiceNumber: string; grandTotal: string | number };
      };
      if (r.queued) {
        toast('Sale saved offline — will sync when online', { icon: <PackageCheck size={16} /> });
        // OFFLINE-05: the receipt needs no network call — everything it shows is already
        // in memory from the cart just completed, so it works identically offline.
        setLastSale({
          invoiceId: 0,
          invoiceNumber: 'Pending sync',
          grandTotal,
          lines: cart,
          customer,
          paymentMode,
          amountTendered: parseFloat(amountTendered) || amountDue,
          change,
          synced: false,
        });
      } else {
        toast.success('Sale complete!');
        if (r.data) {
          setLastSale({
            invoiceId: r.data.invoiceId,
            invoiceNumber: r.data.invoiceNumber,
            grandTotal: parseFloat(String(r.data.grandTotal)),
            lines: cart,
            customer,
            paymentMode,
            amountTendered: parseFloat(amountTendered) || amountDue,
            change,
            synced: true,
          });
        }
      }
      void refreshPendingCount();
      clearCart();
      setCustomer(null);
      setShowPayment(false);
      setAmountTendered('');
      setOrderDiscountPct('');
      setSplitEnabled(false);
      setSplitRows([
        { mode: 'CASH', amount: '' },
        { mode: 'CARD', amount: '' },
      ]);
      setRedeemPoints('');
      setSelectedRewardId('');
      barcodeRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Held sales — OFFLINE-05: local Dexie is the source of truth for park/resume, so this
  // works fully offline (single-terminal design — see phase doc). If backend persistence
  // is reachable, a best-effort audit copy is posted too, but it never blocks or gates the
  // local park/resume flow.
  const { data: heldSalesData } = useQuery({
    queryKey: ['pos-held-sales'],
    queryFn: () => getAllHeldSales(),
    enabled: showHeldSales,
  });
  const heldSales = heldSalesData ?? [];

  const holdSaleMutation = useMutation({
    mutationFn: async () => {
      const claims = getAuthClaims();
      const now = Date.now();
      await upsertHeldSale({
        tenantId: claims?.tenantId ?? 0,
        branchId: selectedBranch?.branchId ?? 0,
        ...(customer?.id !== undefined ? { customerId: customer.id } : {}),
        cart,
        createdAt: now,
        updatedAt: now,
      });
      if (isOnline) {
        // Fire-and-forget audit copy — failures are ignored, the sale is already held locally.
        authFetch(`${SALES_API}/pos/held-sales`, {
          method: 'POST',
          body: JSON.stringify({ sessionId, customerId: customer?.id, cart }),
        }).catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success('Sale held');
      clearCart();
      setCustomer(null);
      barcodeRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeHeldSale = async (id: number) => {
    const held = await getHeldSaleById(id);
    if (!held) {
      toast.error('Failed to resume held sale');
      return;
    }
    restoreCart(held.cart as CartItem[]);
    if (held.customerId) {
      const cached = await getCustomerById(held.customerId);
      if (cached)
        setCustomer({ id: cached.id, displayName: cached.displayName, phone: cached.phone });
    }
    await deleteHeldSale(id);
    setShowHeldSales(false);
    void qc.invalidateQueries({ queryKey: ['pos-held-sales'] });
    toast.success('Sale resumed');
  };

  const discardHeldSale = async (id: number) => {
    await deleteHeldSale(id);
    void qc.invalidateQueries({ queryKey: ['pos-held-sales'] });
  };

  // Quick customer creation (name + phone only) — reuses the same POST /customers
  // sales-service already exposes for the full customer form. OFFLINE-05: offline,
  // this queues locally under a negative placeholder id (mirroring OFFLINE-02's
  // client-generated-id sale pattern) instead of failing outright.
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const createCustomerMutation = useMutation({
    mutationFn: async (): Promise<{ data: Customer; queued: boolean }> => {
      const payload = {
        displayName: newCustName,
        phone: newCustPhone,
        branchId: selectedBranch?.branchId ?? 0,
      };
      if (!isOnline) {
        const claims = getAuthClaims();
        const localCustomerId = -Date.now();
        const cached: CachedCustomer = {
          id: localCustomerId,
          tenantId: claims?.tenantId ?? 0,
          branchId: selectedBranch?.branchId ?? 0,
          displayName: newCustName,
          phone: newCustPhone,
          customerType: 'RETAIL',
          updatedAt: new Date().toISOString(),
        };
        await upsertCustomers([cached]);
        await queueCustomer(payload, localCustomerId);
        void registerBackgroundSync();
        return {
          data: { id: localCustomerId, displayName: newCustName, phone: newCustPhone },
          queued: true,
        };
      }
      const res = await authFetch(`${SALES_API}/customers`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new Error(friendlyErrorMessage(err.error, 'Failed to create customer'));
      }
      const body = (await res.json()) as { data: Customer };
      return { data: body.data, queued: false };
    },
    onSuccess: (result) => {
      setCustomer(result.data);
      setShowNewCustomer(false);
      setNewCustName('');
      setNewCustPhone('');
      void refreshPendingCount();
      void qc.invalidateQueries({ queryKey: ['pos-customer-local'] });
      if (result.queued)
        toast('Customer saved offline — will sync when online', {
          icon: <PackageCheck size={16} />,
        });
      else toast.success('Customer created');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Held Sales / New Customer / Payment / Browse Catalog are all independent POSDialog-family
  // overlays with no shared stack manager — opening a second one while another is already up
  // used to leave both mounted (overlapping backdrops, and a single Escape closing both at
  // once, since each installs its own document-level listener). Simplest fix proportionate to
  // this app's size: enforce mutual exclusion at the point something opens, rather than
  // building a generalized modal-stack manager for four overlays.
  const showOnly = useCallback(
    (which: 'payment' | 'heldSales' | 'newCustomer' | 'lookup' | null) => {
      setShowPayment(which === 'payment');
      setShowHeldSales(which === 'heldSales');
      setShowNewCustomer(which === 'newCustomer');
      setShowLookup(which === 'lookup');
    },
    []
  );

  useKeyboardShortcuts({
    barcodeRef,
    cartLength: cart.length,
    highlightedLineItemId,
    lastAddedItem,
    showPayment,
    showHeldSales,
    showNewCustomer,
    isHolding: holdSaleMutation.isPending,
    onNewBill: () => {
      clearCart();
      setCustomer(null);
      setShowPayment(false);
      barcodeRef.current?.focus();
    },
    onOpenLookup: () => showOnly('lookup'),
    onHold: () => holdSaleMutation.mutate(),
    onSetPaymentMode: setPaymentMode,
    onShowPayment: (show) => (show ? showOnly('payment') : setShowPayment(false)),
    onShowHeldSales: (show) => (show ? showOnly('heldSales') : setShowHeldSales(false)),
    onShowNewCustomer: (show) => (show ? showOnly('newCustomer') : setShowNewCustomer(false)),
    onRepeatLast: addItem,
    onUndoLastLine: undoLastLine,
    onMoveLineSelection: moveLineSelection,
  });

  return (
    <>
      <div className="flex flex-col h-screen bg-surface-page font-sans print:hidden overflow-hidden">
        {/* Top bar with connectivity indicator */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <span className="flex items-center gap-2 font-bold text-lg text-primary">
            <ShoppingBag size={20} className="text-brand" />
            POS
          </span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => showOnly('heldSales')}
              className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]"
            >
              <History size={14} />
              Held Sales
            </button>
            <a
              href={WEB_FRONTEND_URL + '/sales/returns/new'}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]"
            >
              <ArrowLeftRight size={14} />
              Returns / Exchange
            </a>
            <button
              onClick={() => showOnly('lookup')}
              className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]"
            >
              <LayoutGrid size={14} />
              Browse Catalog (F3)
            </button>
            <Link
              to="/lookup"
              className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]"
            >
              <SearchIcon size={14} />
              Lookup
            </Link>
            <Link
              to="/shift/close"
              className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]"
            >
              <LogOut size={14} />
              End Shift
            </Link>
            {supportsAnyPrinting() &&
              (hasPermission(PERMISSIONS.POS_MANAGE) ||
                hasPermission(PERMISSIONS.POS_CASH_DRAWER)) && (
                <button
                  onClick={() => void openDrawer()}
                  disabled={drawerOpening}
                  aria-label="Open cash drawer"
                  title="Open cash drawer"
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-secondary hover:text-primary hover:bg-surface-raised transition-colors disabled:opacity-50"
                >
                  <DoorOpen size={16} />
                </button>
              )}
            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <SyncStatusPanel
              online={isOnline}
              pendingCount={pendingCount}
              stuckCount={stuckCount}
              conflictCount={conflictSales.length}
              lastSyncedAt={lastSyncedAt}
              onSyncNow={() => void syncPendingCustomers().then(() => syncPending())}
              onRetryStuck={() => void retryStuckItems()}
              onShowConflicts={() => setShowConflicts(true)}
            />
          </div>
        </div>

        {/* Full-width sticky search bar */}
        <div className="sticky top-0 z-10 bg-surface-page px-4 pb-3 shrink-0">
          <POSOmnibox
            barcodeRef={barcodeRef}
            videoRef={videoRef}
            scanFlash={scanFlash}
            cameraOpen={cameraOpen}
            onToggleCamera={() => setCameraOpen((v) => !v)}
            onSubmit={(value) => void resolveAndAddItem(value)}
            onSelectItem={(item) => {
              addItem(item);
              flashFeedback('success');
            }}
          />

          {/* Keyboard shortcut hints — the handlers for these live in the useEffect above */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary mt-2">
            <span className="flex items-center gap-1">
              <Kbd>F2</Kbd> New bill
            </span>
            <span className="flex items-center gap-1">
              <Kbd>F3</Kbd> Browse catalog
            </span>
            <span className="flex items-center gap-1">
              <Kbd>F4</Kbd> Hold sale
            </span>
            <span className="flex items-center gap-1">
              <Kbd>F5</Kbd>/<Kbd>F6</Kbd>/<Kbd>F7</Kbd> Cash/Card/UPI
            </span>
            <span className="flex items-center gap-1">
              <Kbd>F8</Kbd> Charge
            </span>
            <span className="flex items-center gap-1">
              <Kbd>F9</Kbd> Repeat last item
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> Undo last
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd> Focus search
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>/<Kbd>↓</Kbd>+<Kbd>Ctrl</Kbd>+<Kbd>D</Kbd> Line discount
            </span>
          </div>
        </div>

        {/* Current Sale — full width, directly below the search bar */}
        <div className="flex flex-col md:flex-row border-y border-default bg-surface-card shrink-0">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
              <h2 className="text-lg font-bold text-primary">Current Sale</h2>

              {/* Customer search */}
              <div className="relative w-full sm:w-72">
                <div className="flex gap-2">
                  <POSInput
                    type="text"
                    placeholder="Customer search (name or phone)…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    wrapperClassName="flex-1"
                  />
                  <POSButton variant="outline" onClick={() => showOnly('newCustomer')}>
                    <UserPlus size={16} />
                    New
                  </POSButton>
                </div>
                {customerResults.length > 0 && (
                  <div
                    className="absolute top-full left-0 right-0 bg-surface-overlay border border-default rounded-xl shadow-token-lg max-h-40 overflow-y-auto mt-1"
                    style={{ zIndex: 'var(--z-dropdown)' }}
                  >
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setCustomer(c);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-raised transition-colors"
                      >
                        <span className="font-medium text-primary">{c.displayName}</span>
                        <span className="text-secondary ml-2">{c.phone}</span>
                        {c.loyaltyPoints && (
                          <span className="text-warning ml-2">{c.loyaltyPoints} pts</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {customer && (
                  <div className="mt-1 text-sm text-success flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Check size={14} /> {customer.displayName}
                    </span>
                    <button
                      onClick={() => setCustomer(null)}
                      aria-label="Clear customer"
                      className="text-secondary hover:text-primary"
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <POSCart
                items={cart}
                onUpdateQty={updateQty}
                onUpdateDiscount={updateDiscount}
                highlightedItemId={highlightedLineItemId}
              />
            </div>
          </div>

          <div className="w-full md:w-80 shrink-0 border-t md:border-t-0 md:border-l border-default p-4 space-y-3">
            <POSSummary
              totalItems={totalItems}
              totalQuantity={totalQuantity}
              subtotal={subtotal}
              discountAmount={discountAmount}
              taxAmount={taxAmount}
              grandTotal={grandTotal}
              orderDiscountPct={orderDiscountPct}
              onOrderDiscountChange={(value) => {
                setOrderDiscountPct(value);
                applyOrderDiscount(parseFloat(value) || 0);
              }}
              showDiscountInput={!showPayment && cart.length > 0}
            />

            {!showPayment ? (
              <div className="flex gap-2">
                <POSButton
                  variant="secondary"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => void holdSaleMutation.mutate()}
                  className="flex-1"
                >
                  Hold
                </POSButton>
                <POSButton
                  variant="primary"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => showOnly('payment')}
                  className="flex-[3] text-lg"
                >
                  Charge (F8)
                </POSButton>
              </div>
            ) : (
              <POSPaymentPanel
                customer={customer}
                redeemPoints={redeemPoints}
                onRedeemPointsChange={setRedeemPoints}
                rewardCatalog={rewardCatalog}
                selectedRewardId={selectedRewardId}
                onSelectedRewardIdChange={setSelectedRewardId}
                splitEnabled={splitEnabled}
                onSplitEnabledChange={setSplitEnabled}
                splitRows={splitRows}
                onSplitRowsChange={setSplitRows}
                paymentMode={paymentMode}
                onPaymentModeChange={setPaymentMode}
                amountTendered={amountTendered}
                onAmountTenderedChange={setAmountTendered}
                amountDue={amountDue}
                change={change}
                upiVpa={upiVpa}
                upiPayeeName={upiPayeeName}
                onBack={() => setShowPayment(false)}
                onCompleteSale={() => saleMutation.mutate()}
                isProcessing={saleMutation.isPending}
              />
            )}
          </div>
        </div>

        {/* Product grid (catalog) — occupies the remaining page space */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {quickItems.map((item) => (
              <POSProductCard
                key={item.id}
                item={item}
                onSelect={(i) => {
                  addItem(i);
                  barcodeRef.current?.focus();
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {lastSale && <ReceiptOverlay sale={lastSale} onClose={() => setLastSale(null)} />}

      {showConflicts && (
        <StockConflictModal
          conflicts={conflictSales}
          onResolve={(id, action) => void handleResolveConflict(id, action)}
          onClose={() => setShowConflicts(false)}
        />
      )}

      <POSDialog
        open={showHeldSales}
        onClose={() => setShowHeldSales(false)}
        title="Held Sales"
        size="md"
      >
        {heldSales.length === 0 ? (
          <p className="text-sm text-disabled text-center py-6">No held sales</p>
        ) : (
          <div className="space-y-2">
            {heldSales.map((h) => {
              const lineCount = (h.cart as CartItem[]).length;
              return (
                <div
                  key={h.id}
                  className="flex items-center justify-between bg-surface-subtle rounded-xl p-3"
                >
                  <div className="text-sm">
                    <div className="font-medium text-primary">
                      {lineCount} item{lineCount === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-secondary">
                      {new Date(h.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <POSButton
                      size="sm"
                      variant="primary"
                      onClick={() => void resumeHeldSale(h.id!)}
                    >
                      Resume
                    </POSButton>
                    <POSButton
                      size="sm"
                      variant="secondary"
                      onClick={() => void discardHeldSale(h.id!)}
                    >
                      Discard
                    </POSButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </POSDialog>

      <POSDialog
        open={showNewCustomer}
        onClose={() => setShowNewCustomer(false)}
        title="New Customer"
        size="sm"
      >
        <div className="space-y-3">
          <POSInput
            type="text"
            placeholder="Name"
            value={newCustName}
            onChange={(e) => setNewCustName(e.target.value)}
          />
          <POSInput
            type="tel"
            placeholder="Phone"
            value={newCustPhone}
            onChange={(e) => setNewCustPhone(e.target.value)}
          />
          <POSButton
            variant="primary"
            size="lg"
            disabled={
              newCustName.length < 2 || newCustPhone.length < 10 || createCustomerMutation.isPending
            }
            onClick={() => createCustomerMutation.mutate()}
            loading={createCustomerMutation.isPending}
            className="w-full"
          >
            {createCustomerMutation.isPending ? 'Creating…' : 'Create & Select'}
          </POSButton>
        </div>
      </POSDialog>

      <POSItemLookupModal
        open={showLookup}
        onClose={() => {
          setShowLookup(false);
          barcodeRef.current?.focus();
        }}
        onSelectItem={(item) => {
          addItem(item);
          flashFeedback('success');
        }}
      />
    </>
  );
}
