// OFFLINE-09 (rescoped to pos-frontend): read-only counter lookup for item/price/tax and
// customer details, backed entirely by the reference data OFFLINE-04 already syncs into
// Dexie (catalogItems, customers) — no new sync endpoint or storage added for this screen.
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getAllCatalogItems, getAllCustomers, getSyncMeta } from './localStore.js';
import type { CatalogItem, CachedCustomer } from './db.js';
import { ConnectivityDot, formatLastSync } from './ConnectivityStatus.js';
import POSInput from './components/pos/POSInput.js';

type Tab = 'items' | 'customers';

export default function LookupScreen() {
  const [tab, setTab] = useState<Tab>('items');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [customers, setCustomers] = useState<CachedCustomer[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    void getAllCatalogItems().then(setItems);
    void getAllCustomers().then(setCustomers);
  }, []);

  // Each tab shows the staleness of the specific store it displays, rather than a single
  // combined timestamp — items and customers sync on independent cursors (referenceSync.ts).
  useEffect(() => {
    void getSyncMeta(tab === 'items' ? 'catalogItems' : 'customers').then(
      (meta) => setLastSyncedAt(meta?.lastSyncedAt ?? null)
    );
  }, [tab]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((i) => i.name.toLowerCase().includes(q) || i.barcode?.toLowerCase().includes(q) || i.itemCode?.toLowerCase().includes(q))
      .slice(0, 50);
  }, [items, query]);

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers
      .filter((c) => c.displayName.toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 50);
  }, [customers, query]);

  return (
    <div className="flex flex-col h-screen bg-surface-page font-sans p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]">
            <ArrowLeft size={14} />
            Back to POS
          </Link>
          <span className="font-semibold text-primary">Lookup</span>
        </div>
        <div className="flex items-center gap-3">
          <ConnectivityDot online={isOnline} pendingCount={0} />
          <span className="text-xs text-secondary" title="Last successful reference-data sync for this tab">
            Last sync: {formatLastSync(lastSyncedAt)}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { setTab('items'); setQuery(''); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === 'items' ? 'bg-primary text-primary-fg' : 'bg-surface-card text-secondary hover:bg-surface-raised'}`}
        >
          Items
        </button>
        <button
          onClick={() => { setTab('customers'); setQuery(''); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === 'customers' ? 'bg-primary text-primary-fg' : 'bg-surface-card text-secondary hover:bg-surface-raised'}`}
        >
          Customers
        </button>
      </div>

      <POSInput
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tab === 'items' ? 'Search by name, barcode or item code…' : 'Search by name or phone…'}
        wrapperClassName="max-w-md"
      />

      <div className="flex-1 overflow-auto bg-surface-card rounded-xl shadow-token-sm border border-default">
        {tab === 'items' ? (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-raised text-left text-xs text-secondary">
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Barcode</th>
                <th className="p-2">HSN</th>
                <th className="p-2">MRP</th>
                <th className="p-2">Sale Price</th>
                <th className="p-2">GST%</th>
                <th className="p-2">Cess%</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((i) => (
                <tr key={i.id} className="border-t border-default text-primary">
                  <td className="p-2">{i.name}</td>
                  <td className="p-2">{i.barcode ?? '-'}</td>
                  <td className="p-2">{i.hsnCode}</td>
                  <td className="p-2">{i.mrp ?? '-'}</td>
                  <td className="p-2">{i.salePrice}</td>
                  <td className="p-2">{i.gstRate}</td>
                  <td className="p-2">{i.cessRate}</td>
                  <td className="p-2">{i.status}</td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-disabled">No items found</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-raised text-left text-xs text-secondary">
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Alt Phone</th>
                <th className="p-2">Email</th>
                <th className="p-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => (
                <tr key={c.id} className="border-t border-default text-primary">
                  <td className="p-2">{c.displayName}</td>
                  <td className="p-2">{c.phone}</td>
                  <td className="p-2">{c.altPhone ?? '-'}</td>
                  <td className="p-2">{c.email ?? '-'}</td>
                  <td className="p-2">{c.customerType}</td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-disabled">No customers found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
