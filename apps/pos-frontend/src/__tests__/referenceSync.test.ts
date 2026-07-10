/**
 * OFFLINE-04 — referenceSync.ts's generic paginated pull-and-upsert loop.
 * Mocks global fetch (same style as auth.test.ts) and runs against the real Dexie db via
 * fake-indexeddb, so upserts and syncMeta cursor behavior are verified end-to-end rather
 * than through mocked Dexie calls.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db.js';
import { getSyncMeta, setSyncMeta } from '../localStore.js';
import { setTokens } from '../auth.js';
import { syncAllReferenceData } from '../referenceSync.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EMPTY_PAGE = { data: { content: [], totalElements: 0, hasMore: false } };

function makeFetchMock(overrides: Partial<Record<'items' | 'customers' | 'priceListItems' | 'taxRates', (url: string) => Response>> = {}) {
  return vi.fn((url: string) => {
    if (url.includes('/sync/items')) return Promise.resolve(overrides.items ? overrides.items(url) : jsonResponse(200, EMPTY_PAGE));
    if (url.includes('/sync/customers')) return Promise.resolve(overrides.customers ? overrides.customers(url) : jsonResponse(200, EMPTY_PAGE));
    if (url.includes('/sync/price-list-items')) return Promise.resolve(overrides.priceListItems ? overrides.priceListItems(url) : jsonResponse(200, EMPTY_PAGE));
    if (url.includes('/sync/tax-rates')) return Promise.resolve(overrides.taxRates ? overrides.taxRates(url) : jsonResponse(200, EMPTY_PAGE));
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

beforeEach(async () => {
  await db.catalogItems.clear();
  await db.customers.clear();
  await db.priceListItems.clear();
  await db.taxRates.clear();
  await db.syncMeta.clear();
  setTokens('access-1', 'refresh-1');
});

describe('syncAllReferenceData', () => {
  it('pages through hasMore and upserts every page into the Dexie table', async () => {
    let call = 0;
    const fetchMock = makeFetchMock({
      items: () => {
        call++;
        if (call === 1) {
          return jsonResponse(200, { data: { content: [{ id: 1, tenantId: 1, name: 'A', hsnCode: '1', gstRate: 18, cessRate: 0, salePrice: 10, unitId: 1, status: 'ACTIVE', updatedAt: new Date().toISOString() }], totalElements: 2, hasMore: true } });
        }
        return jsonResponse(200, { data: { content: [{ id: 2, tenantId: 1, name: 'B', hsnCode: '2', gstRate: 18, cessRate: 0, salePrice: 20, unitId: 1, status: 'ACTIVE', updatedAt: new Date().toISOString() }], totalElements: 2, hasMore: false } });
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncAllReferenceData(true);

    const stored = await db.catalogItems.toArray();
    expect(stored.map((i) => i.id).sort()).toEqual([1, 2]);
  });

  it('sends the stored lastSyncedAt cursor as modifiedSince and advances it only after full success', async () => {
    const priorCursor = Date.now() - 100_000;
    await setSyncMeta({ store: 'customers', lastSyncedAt: priorCursor });

    let capturedUrl = '';
    const fetchMock = makeFetchMock({
      customers: (url) => {
        capturedUrl = url;
        return jsonResponse(200, {
          data: { content: [{ id: 5, tenantId: 1, branchId: 1, displayName: 'X', phone: '1', customerType: 'RETAIL', updatedAt: new Date().toISOString() }], totalElements: 1, hasMore: false },
        });
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    await syncAllReferenceData(true);
    const after = Date.now();

    expect(capturedUrl).toContain(encodeURIComponent(new Date(priorCursor).toISOString()));
    const meta = await getSyncMeta('customers');
    expect(meta!.lastSyncedAt).toBeGreaterThanOrEqual(before);
    expect(meta!.lastSyncedAt).toBeLessThanOrEqual(after);
  });

  it('leaves lastSyncedAt unchanged for an entity whose sync fails, without blocking the others', async () => {
    const priorCursor = Date.now() - 100_000;
    await setSyncMeta({ store: 'priceListItems', lastSyncedAt: priorCursor });

    const fetchMock = makeFetchMock({
      priceListItems: () => jsonResponse(500, { error: 'boom' }),
      customers: () => jsonResponse(200, {
        data: { content: [{ id: 9, tenantId: 1, branchId: 1, displayName: 'Y', phone: '2', customerType: 'RETAIL', updatedAt: new Date().toISOString() }], totalElements: 1, hasMore: false },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncAllReferenceData(true);

    const failedMeta = await getSyncMeta('priceListItems');
    expect(failedMeta!.lastSyncedAt).toBe(priorCursor);

    const succeededMeta = await getSyncMeta('customers');
    expect(succeededMeta).toBeDefined();
    expect(succeededMeta!.lastSyncedAt).not.toBe(priorCursor);
  });

  it('de-dupes overlapping triggers into a single in-flight run', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const p1 = syncAllReferenceData(true);
    const p2 = syncAllReferenceData(true);
    await Promise.all([p1, p2]);

    // 4 entities, each fetched exactly once — a second overlapping trigger must not
    // cause a duplicate round of requests.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('suppresses a non-forced re-sync within the minimum interval, after a prior sync just ran', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    await syncAllReferenceData(true);
    fetchMock.mockClear();

    await syncAllReferenceData();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
