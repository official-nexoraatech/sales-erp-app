/**
 * OFFLINE-06 — swSync.ts's Background-Sync-safe sync core. Verifies it behaves like
 * POSScreen.tsx's page-context syncPending/syncPendingCustomers (same success/failure/
 * retry/dedupe semantics via the shared offlineDb.ts primitives) while authenticating off
 * the IndexedDB token mirror instead of localStorage.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db.js';
import { mirrorTokens } from '../tokenStore.js';
import { queueSale, queueCustomer, getPendingSales, getPendingCustomers } from '../offlineDb.js';
import { getSyncMeta } from '../localStore.js';
import { runBackgroundSync, PENDING_SYNC_META_STORE } from '../swSync.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  await db.pendingSales.clear();
  await db.pendingCustomers.clear();
  await db.customers.clear();
  await db.syncMeta.clear();
  await db.authTokens.clear();
  vi.restoreAllMocks();
});

describe('runBackgroundSync', () => {
  it('does nothing (and never calls fetch) when no token has ever been mirrored', async () => {
    await queueSale({ sessionId: 1 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result).toEqual({ syncedSales: 0, syncedCustomers: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await getPendingSales()).toHaveLength(1);
  });

  it('syncs a pending sale using the mirrored access token and removes it from the queue', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    await queueSale({ sessionId: 1 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { invoiceId: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedSales).toBe(1);
    expect(await getPendingSales()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/pos/sales');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer access-1');
  });

  it('refreshes an expired token once and retries the sale with the new token', async () => {
    await mirrorTokens('dead-access', 'refresh-1');
    await queueSale({ sessionId: 1 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' })) // original sale attempt
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' })) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { data: { invoiceId: 1 } })); // retried sale
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedSales).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain('/auth/refresh');
    expect(await getPendingSales()).toEqual([]);
  });

  it('increments retries (without deleting) on a failed sync attempt', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    await queueSale({ sessionId: 1 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedSales).toBe(0);
    const pending = await getPendingSales();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.retries).toBe(1);
  });

  it('records lastSyncedAt in the shared syncMeta store only when something actually synced', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);

    // No pending items at all — nothing to sync, so no timestamp should be written.
    await runBackgroundSync();
    expect(await getSyncMeta(PENDING_SYNC_META_STORE)).toBeUndefined();

    await queueSale({ sessionId: 1 });
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { invoiceId: 1 } }));
    const before = Date.now();
    await runBackgroundSync();

    const meta = await getSyncMeta(PENDING_SYNC_META_STORE);
    expect(meta).toBeDefined();
    expect(meta!.lastSyncedAt).toBeGreaterThanOrEqual(before);
  });

  it('syncs pending customers before sales, rewriting a queued sale referencing the local placeholder id', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    await queueCustomer({ displayName: 'Walk-in', phone: '9' }, -1);
    await queueSale({ sessionId: 1, customerId: -1 });

    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/customers')) {
        return Promise.resolve(jsonResponse(200, {
          data: { id: 501, tenantId: 1, branchId: 1, displayName: 'Walk-in', phone: '9', customerType: 'RETAIL', updatedAt: new Date().toISOString() },
        }));
      }
      return Promise.resolve(jsonResponse(200, { data: { invoiceId: 1 } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedCustomers).toBe(1);
    expect(result.syncedSales).toBe(1);
    expect(await getPendingCustomers()).toEqual([]);
    expect(await getPendingSales()).toEqual([]);

    // The real server id must have replaced the local placeholder before the sale synced —
    // otherwise this order-of-operations bug is exactly the cross-queue FK hazard OFFLINE-05
    // fixed for the page-context path.
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const saleCall = calls.find(([url]) => url.includes('/pos/sales'))!;
    const body = JSON.parse(saleCall[1].body as string) as { customerId: number };
    expect(body.customerId).toBe(501);
  });
});
