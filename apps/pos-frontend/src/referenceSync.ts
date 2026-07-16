// OFFLINE-04 — pulls reference data (catalog, customers, price lists, tax rates) from
// the new public delta-sync download endpoints into the OFFLINE-03 Dexie stores, so the
// POS has a usable local mirror to fall back on during an outage.
import toast from 'react-hot-toast';
import { authFetch } from './auth.js';
import type { CatalogItem, CachedCustomer, CachedPriceListItem, CachedTaxRate } from './db.js';
import {
  getSyncMeta,
  setSyncMeta,
  upsertCatalogItems,
  upsertCustomers,
  upsertPriceListItems,
  upsertTaxRates,
} from './localStore.js';

// Routed through api-gateway rather than calling services directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';
const INVENTORY_API =
  import.meta.env['VITE_INVENTORY_API_URL'] ?? 'http://localhost:3000/api/inventory';

const PAGE_SIZE = 200;
// A flapping connection shouldn't trigger a fresh full sync on every 'online' blip.
const MIN_SYNC_INTERVAL_MS = 60_000;

interface SyncEnvelope<T> {
  data: { content: T[]; totalElements: number; hasMore: boolean };
}

// Generic paginated pull for one entity: reads its syncMeta cursor, pages through the
// endpoint until hasMore is false, upserts every page into the given Dexie table, then
// advances the cursor to the sync's start time — but only once every page has succeeded.
// A failure partway through pagination throws before the cursor is touched, so the next
// sync resumes from the prior lastSyncedAt instead of silently skipping the failed range.
async function syncEntity<T>(
  store: string,
  endpoint: string,
  upsert: (rows: T[]) => Promise<void>
): Promise<void> {
  const meta = await getSyncMeta(store);
  const modifiedSince = meta?.lastSyncedAt ? new Date(meta.lastSyncedAt).toISOString() : undefined;
  const syncStartedAt = Date.now();

  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const url = new URL(endpoint);
    if (modifiedSince) url.searchParams.set('modifiedSince', modifiedSince);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(PAGE_SIZE));

    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${store} sync failed: HTTP ${res.status}`);
    const body = (await res.json()) as SyncEnvelope<T>;

    await upsert(body.data.content);
    hasMore = body.data.hasMore;
    page++;
  }

  await setSyncMeta({ store, lastSyncedAt: syncStartedAt });
}

let lastSyncTriggeredAt = 0;
let syncInFlight: Promise<void> | null = null;

// Orchestrates all four entity syncs in parallel. Each entity's cursor advances
// independently — one entity failing (e.g. a transient 500 on price lists) doesn't
// block the others from completing and advancing their own cursors.
export async function syncAllReferenceData(force = false): Promise<void> {
  if (syncInFlight) return syncInFlight;

  const now = Date.now();
  if (!force && now - lastSyncTriggeredAt < MIN_SYNC_INTERVAL_MS) return;
  lastSyncTriggeredAt = now;

  syncInFlight = (async () => {
    const results = await Promise.allSettled([
      syncEntity<CatalogItem>('catalogItems', `${INVENTORY_API}/sync/items`, upsertCatalogItems),
      syncEntity<CachedCustomer>('customers', `${SALES_API}/sync/customers`, upsertCustomers),
      syncEntity<CachedPriceListItem>(
        'priceListItems',
        `${INVENTORY_API}/sync/price-list-items`,
        upsertPriceListItems
      ),
      syncEntity<CachedTaxRate>('taxRates', `${INVENTORY_API}/sync/tax-rates`, upsertTaxRates),
    ]);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length > 0) {
      toast.error(
        `Reference data sync incomplete (${failed.length}/${results.length} failed) — will retry`
      );
    }
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}
