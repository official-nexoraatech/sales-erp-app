import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { queueSale, getPendingSales, deletePendingSale } from './offlineDb.js';

const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3013/api/v2';

interface CartItem {
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  lineTotal: number;
}

interface POSItem {
  id: number;
  name: string;
  salePrice?: string;
  gstRate?: number;
  barcode?: string;
}

interface Customer {
  id: number;
  displayName: string;
  phone: string;
  loyaltyPoints?: number;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function computeLineTotal(qty: number, price: number, gst: number): number {
  const taxable = round2(qty * price);
  return round2(taxable + taxable * gst / 100);
}

function ConnectivityDot({ online, pendingCount }: { online: boolean; pendingCount: number }) {
  const color = !online ? 'bg-red-500' : pendingCount > 0 ? 'bg-yellow-400' : 'bg-green-500';
  const label = !online ? 'Offline' : pendingCount > 0 ? `${pendingCount} pending sync` : 'Online';
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} animate-pulse`} />
      <span className={!online ? 'text-red-500' : pendingCount > 0 ? 'text-yellow-500' : 'text-green-600'}>{label}</span>
    </div>
  );
}

export default function POSScreen() {
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'CARD' | 'UPI'>('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [sessionId] = useState(1);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  const accessToken = localStorage.getItem('pos_token') ?? '';

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  const refreshPendingCount = useCallback(async () => {
    const pending = await getPendingSales();
    setPendingCount(pending.length);
  }, []);

  const syncPending = useCallback(async () => {
    const pending = await getPendingSales();
    if (!pending.length) return;
    let synced = 0;
    for (const sale of pending) {
      try {
        const res = await fetch(`${SALES_API}/pos/sales`, {
          method: 'POST',
          headers,
          body: JSON.stringify(sale.payload),
        });
        if (res.ok) {
          await deletePendingSale(sale.id!);
          synced++;
        }
      } catch {
        // keep in queue, will retry on next reconnect
      }
    }
    if (synced > 0) toast.success(`Synced ${synced} offline sale(s)`);
    await refreshPendingCount();
  }, [headers, refreshPendingCount]);

  useEffect(() => {
    void refreshPendingCount();

    // Register service worker
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (event) => {
        if ((event.data as { type?: string })?.type === 'DO_SYNC') {
          void syncPending();
        }
      });
    }

    const handleOnline = () => {
      setIsOnline(true);
      void syncPending();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPending, refreshPendingCount]);

  // Quick items
  const { data: quickData } = useQuery({
    queryKey: ['pos-quick-items'],
    queryFn: async () => {
      const res = await fetch(`${SALES_API}/pos/quick-items`, { headers });
      return res.json() as Promise<{ data: POSItem[] }>;
    },
  });
  const quickItems: POSItem[] = quickData?.data ?? [];

  // Customer search
  const { data: customerData } = useQuery({
    queryKey: ['pos-customer', customerSearch],
    queryFn: async () => {
      if (customerSearch.length < 2) return { data: [] };
      const res = await fetch(`${SALES_API}/pos/customer-search?q=${encodeURIComponent(customerSearch)}`, { headers });
      return res.json() as Promise<{ data: Customer[] }>;
    },
    enabled: customerSearch.length > 1,
  });
  const customerResults: Customer[] = (customerData as { data?: Customer[] })?.data ?? [];

  // Focus barcode input on mount
  useEffect(() => { barcodeRef.current?.focus(); }, []);

  const grandTotal = cart.reduce((s, l) => s + l.lineTotal, 0);
  const change = Math.max(0, round2((parseFloat(amountTendered) || 0) - grandTotal));

  const addItem = (item: POSItem) => {
    const price = parseFloat(item.salePrice ?? '0');
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) => l.itemId === item.id
          ? { ...l, quantity: l.quantity + 1, lineTotal: computeLineTotal(l.quantity + 1, l.unitPrice, l.gstRate) }
          : l);
      }
      return [...prev, {
        itemId: item.id,
        itemName: item.name,
        quantity: 1,
        unitPrice: price,
        gstRate: item.gstRate ?? 18,
        lineTotal: computeLineTotal(1, price, item.gstRate ?? 18),
      }];
    });
  };

  const updateQty = (itemId: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.itemId !== itemId));
    } else {
      setCart((prev) => prev.map((l) => l.itemId === itemId
        ? { ...l, quantity: qty, lineTotal: computeLineTotal(qty, l.unitPrice, l.gstRate) }
        : l));
    }
  };

  const salePayload = () => ({
    sessionId,
    customerId: customer?.id,
    branchId: 1,
    warehouseId: 1,
    placeOfSupply: '27',
    sellerStateCode: '27',
    lines: cart.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      gstRate: l.gstRate,
      discountPct: 0,
    })),
    paymentMode,
    amountTendered: parseFloat(amountTendered) || grandTotal,
  });

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!isOnline) {
        await queueSale(salePayload());
        return { queued: true };
      }
      const res = await fetch(`${SALES_API}/pos/sales`, {
        method: 'POST',
        headers,
        body: JSON.stringify(salePayload()),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        // Network error during online attempt — queue for retry
        await queueSale(salePayload());
        throw new Error(err.error ?? 'Sale failed — queued for retry');
      }
      return res.json();
    },
    onSuccess: (result) => {
      if ((result as { queued?: boolean }).queued) {
        toast('Sale saved offline — will sync when online', { icon: '📦' });
      } else {
        toast.success('Sale complete!');
      }
      void refreshPendingCount();
      setCart([]);
      setCustomer(null);
      setShowPayment(false);
      setAmountTendered('');
      barcodeRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-950 font-sans">
      {/* Left — item grid */}
      <div className="flex flex-col w-2/3 p-4 gap-4">
        {/* Top bar with connectivity indicator */}
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-700 dark:text-gray-300">POS</span>
          <div className="flex items-center gap-3">
            <ConnectivityDot online={isOnline} pendingCount={pendingCount} />
            {isOnline && pendingCount > 0 && (
              <button
                onClick={() => void syncPending()}
                className="text-xs text-blue-600 underline"
              >
                Sync now
              </button>
            )}
          </div>
        </div>

        {/* Barcode input */}
        <input
          ref={barcodeRef}
          type="text"
          placeholder="Scan barcode or type item name..."
          className="w-full rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-3 text-lg"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.currentTarget;
              const match = quickItems.find((i) => i.barcode === target.value || i.name.toLowerCase().includes(target.value.toLowerCase()));
              if (match) { addItem(match); target.value = ''; }
            }
          }}
        />

        {/* Quick item grid */}
        <div className="grid grid-cols-4 gap-3 overflow-y-auto flex-1">
          {quickItems.map((item) => (
            <button
              key={item.id}
              onClick={() => addItem(item)}
              className="bg-white dark:bg-gray-900 rounded-xl border-2 border-gray-200 dark:border-gray-700 p-3 text-center hover:border-blue-500 active:scale-95 transition-transform"
            >
              <div className="text-sm font-semibold truncate">{item.name}</div>
              <div className="text-lg font-bold mt-1">₹{parseFloat(item.salePrice ?? '0').toFixed(2)}</div>
            </button>
          ))}
        </div>

        {/* Customer search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Customer search (name or phone)..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm"
          />
          {customerResults.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-40 overflow-y-auto mb-1 z-10">
              {customerResults.map((c) => (
                <button key={c.id} onClick={() => { setCustomer(c); setCustomerSearch(''); }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                  <span className="font-medium">{c.displayName}</span>
                  <span className="text-gray-500 ml-2">{c.phone}</span>
                  {c.loyaltyPoints && <span className="text-yellow-600 ml-2">{c.loyaltyPoints} pts</span>}
                </button>
              ))}
            </div>
          )}
          {customer && (
            <div className="mt-1 text-sm text-green-600 flex items-center gap-2">
              <span>✓ {customer.displayName}</span>
              <button onClick={() => setCustomer(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}
        </div>
      </div>

      {/* Right — cart */}
      <div className="flex flex-col w-1/3 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-bold">Current Sale</h2>
          {customer && <p className="text-sm text-gray-500">{customer.displayName}</p>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 && (
            <p className="text-center text-gray-400 text-sm mt-8">Cart is empty</p>
          )}
          {cart.map((l) => (
            <div key={l.itemId} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{l.itemName}</div>
                <div className="text-xs text-gray-500">₹{l.unitPrice.toFixed(2)} × {l.quantity}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => updateQty(l.itemId, l.quantity - 1)} className="w-7 h-7 rounded bg-gray-200 dark:bg-gray-700 text-center font-bold">−</button>
                <span className="w-8 text-center text-sm font-semibold">{l.quantity}</span>
                <button onClick={() => updateQty(l.itemId, l.quantity + 1)} className="w-7 h-7 rounded bg-gray-200 dark:bg-gray-700 text-center font-bold">+</button>
              </div>
              <div className="text-sm font-semibold w-20 text-right">₹{l.lineTotal.toFixed(2)}</div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t dark:border-gray-700 space-y-3">
          <div className="flex justify-between text-2xl font-bold">
            <span>Total</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>

          {!showPayment ? (
            <button
              disabled={cart.length === 0}
              onClick={() => setShowPayment(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-4 text-lg font-bold"
            >
              Charge
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                {(['CASH', 'CARD', 'UPI'] as const).map((m) => (
                  <button key={m}
                    onClick={() => setPaymentMode(m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 ${paymentMode === m ? 'border-blue-500 bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {paymentMode === 'CASH' && (
                <>
                  <input
                    type="number"
                    placeholder="Amount tendered"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-lg text-right"
                  />
                  {parseFloat(amountTendered) >= grandTotal && (
                    <div className="flex justify-between text-green-600 font-semibold">
                      <span>Change</span>
                      <span>₹{change.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowPayment(false)} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 font-semibold">Back</button>
                <button
                  onClick={() => saleMutation.mutate()}
                  disabled={saleMutation.isPending}
                  className="flex-[2] py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-lg disabled:opacity-50"
                >
                  {saleMutation.isPending ? 'Processing…' : 'Complete Sale'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
