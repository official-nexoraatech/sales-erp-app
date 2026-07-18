import { useInfiniteQuery } from '@tanstack/react-query';
import { authFetch } from '../auth.js';
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

// Shared by POSOmnibox (query only) and POSItemLookupModal (query + filters) — both hit the
// same GET /pos/items/search endpoint, so the debounced/cancellable/cursor-paginated fetch
// logic lives here once instead of twice.
export function useItemSearch(query: string, filters: ItemSearchFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['pos-item-search', query, filters],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q: query, limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      if (filters.category !== undefined) params.set('category', String(filters.category));
      if (filters.brand !== undefined) params.set('brand', String(filters.brand));
      if (filters.priceListId !== undefined) params.set('priceListId', String(filters.priceListId));
      if (filters.warehouseId !== undefined) params.set('warehouseId', String(filters.warehouseId));
      if (filters.inStockOnly) params.set('inStockOnly', 'true');

      const res = await authFetch(`${SALES_API}/pos/items/search?${params.toString()}`, {
        signal,
      });
      if (!res.ok) throw new Error('Search failed');
      return res.json() as Promise<SearchPage>;
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
  });
}
