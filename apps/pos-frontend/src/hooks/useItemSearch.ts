import { useInfiniteQuery } from '@tanstack/react-query';
import { authFetch } from '../auth.js';
import { getAllCatalogItems } from '../localStore.js';
import type { CatalogItem } from '../db.js';
import type { POSSearchResult } from '../components/pos/types.js';

const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';

export interface ItemSearchFilters {
  category?: number;
  brand?: number;
  priceListId?: number;
  warehouseId?: number;
  inStockOnly?: boolean;
}

interface SearchPage {
  data: POSSearchResult[];
  nextCursor: string | null;
}

function toSearchResult(
  item: CatalogItem,
  matchedOn: POSSearchResult['matchedOn']
): POSSearchResult {
  return {
    itemId: item.id,
    name: item.name,
    sku: item.itemCode ?? null,
    barcode: item.barcode ?? null,
    alias: null,
    supplierCode: null,
    customCode: null,
    price: item.salePrice,
    gstRate: item.gstRate,
    cessRate: item.cessRate,
    // No stock quantity is synced to the client (no /sync/stock endpoint exists) — `null`
    // tells the UI to show "Stock unknown" rather than fabricating an in-stock/out-of-stock
    // claim it can't actually back up.
    stock: { qty: null },
    matchedOn,
  };
}

// Offline (or unreachable-server) fallback: the full catalog is already synced to Dexie by
// referenceSync.ts for exactly this purpose — LookupScreen.tsx already reads it this way for
// its read-only counter lookup. Category/brand filters are honored (both are cached fields);
// priceListId/warehouseId/inStockOnly can't be, since price-list-specific pricing and stock
// counts aren't synced offline — silently ignored rather than misfiltering against stale or
// absent data. Mirrors LookupScreen's substring-match + 50-row cap rather than a new scheme.
async function searchOffline(query: string, filters: ItemSearchFilters): Promise<SearchPage> {
  const q = query.trim().toLowerCase();
  const all = await getAllCatalogItems();
  const matched = all.filter((item) => {
    if (item.status !== 'ACTIVE') return false;
    if (filters.category !== undefined && item.categoryId !== filters.category) return false;
    if (filters.brand !== undefined && item.brandId !== filters.brand) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.barcode?.toLowerCase().includes(q) ||
      item.itemCode?.toLowerCase().includes(q)
    );
  });
  const data = matched
    .slice(0, 50)
    .map((item) => toSearchResult(item, item.barcode === query.trim() ? 'code' : 'name'));
  return { data, nextCursor: null };
}

async function fetchSearchPage(
  query: string,
  filters: ItemSearchFilters,
  cursor: string,
  signal?: AbortSignal
): Promise<SearchPage> {
  if (!navigator.onLine) return searchOffline(query, filters);

  const params = new URLSearchParams({ q: query, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  if (filters.category !== undefined) params.set('category', String(filters.category));
  if (filters.brand !== undefined) params.set('brand', String(filters.brand));
  if (filters.priceListId !== undefined) params.set('priceListId', String(filters.priceListId));
  if (filters.warehouseId !== undefined) params.set('warehouseId', String(filters.warehouseId));
  if (filters.inStockOnly) params.set('inStockOnly', 'true');

  let res: Response;
  try {
    res = await authFetch(
      `${SALES_API}/pos/items/search?${params.toString()}`,
      signal ? { signal } : {}
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // fetch() itself couldn't complete (server unreachable) — fall back to the
    // already-synced local catalog instead of leaving the cashier with no results. A
    // real error response from a reachable server is handled below, not here, so a
    // genuine 4xx/5xx still surfaces as an error rather than being silently masked.
    return searchOffline(query, filters);
  }
  if (!res.ok) throw new Error('Search failed');
  return (await res.json()) as SearchPage;
}

// Used by POSItemLookupModal (Browse Catalog) — reactive, cancellable, cursor-paginated as the
// filters/query change.
export function useItemSearch(query: string, filters: ItemSearchFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['pos-item-search', query, filters],
    queryFn: ({ pageParam, signal }) => fetchSearchPage(query, filters, pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
  });
}

// Used by POSOmnibox on Enter — a single, non-reactive lookup (no live dropdown while typing).
// Same online/offline-fallback fetch path as useItemSearch, just imperative instead of a query.
export async function searchItemsOnce(query: string): Promise<POSSearchResult[]> {
  const page = await fetchSearchPage(query, {}, '');
  return page.data;
}
