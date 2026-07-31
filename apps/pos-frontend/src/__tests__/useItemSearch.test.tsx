/**
 * useItemSearch.ts — GET /pos/items/search during a live sale previously had no offline
 * fallback at all, even though the full catalog is already synced to Dexie by
 * referenceSync.ts for exactly this purpose (LookupScreen.tsx already reads it that way).
 * Offline, a cashier could only sell the ~20 "quick items"; this closes that gap.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../db.js';
import { upsertCatalogItems } from '../localStore.js';
import { useItemSearch } from '../hooks/useItemSearch.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(async () => {
  await db.catalogItems.clear();
  setOnline(true);
  vi.restoreAllMocks();
  localStorage.setItem('pos_token', 'test-token');
});

afterEach(() => {
  setOnline(true);
});

describe('useItemSearch', () => {
  it('uses the live endpoint when online, unaffected by the offline fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: [{ itemId: 1, name: 'Live Item' }], nextCursor: null })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useItemSearch('shirt', {}, true), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.pages[0]?.data[0]?.name).toBe('Live Item');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the locally-synced catalog when navigator.onLine is false', async () => {
    await upsertCatalogItems([
      {
        id: 10,
        tenantId: 1,
        name: 'Offline Shirt',
        barcode: '12345',
        hsnCode: '6109',
        gstRate: 12,
        cessRate: 0,
        salePrice: 499,
        unitId: 1,
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
      },
    ]);
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useItemSearch('shirt', {}, true), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchMock).not.toHaveBeenCalled();
    const results = result.current.data?.pages[0]?.data ?? [];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemId: 10,
      name: 'Offline Shirt',
      cessRate: 0,
      stock: { qty: null },
    });
  });

  it('falls back to the locally-synced catalog when the live request itself fails', async () => {
    await upsertCatalogItems([
      {
        id: 11,
        tenantId: 1,
        name: 'Fallback Item',
        hsnCode: '6109',
        gstRate: 12,
        cessRate: 0,
        salePrice: 199,
        unitId: 1,
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
      },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useItemSearch('fallback', {}, true), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.pages[0]?.data[0]?.name).toBe('Fallback Item');
  });

  it('does not mask a genuine error response from a reachable server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));

    const { result } = renderHook(() => useItemSearch('anything', {}, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('excludes inactive items from the offline fallback', async () => {
    await upsertCatalogItems([
      {
        id: 12,
        tenantId: 1,
        name: 'Discontinued Shirt',
        hsnCode: '6109',
        gstRate: 12,
        cessRate: 0,
        salePrice: 299,
        unitId: 1,
        status: 'DISCONTINUED',
        updatedAt: new Date().toISOString(),
      },
    ]);
    setOnline(false);

    const { result } = renderHook(() => useItemSearch('shirt', {}, true), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.pages[0]?.data).toHaveLength(0);
  });
});
