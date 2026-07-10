/**
 * OFFLINE-10 Step 3 — cross-cutting scenarios that no single OFFLINE-0X phase owns on its
 * own: a full outage-and-recovery cycle spanning a token expiry, the Background-Sync
 * feature-detection fallback, and a stuck stock-conflict resolving to exactly one invoice.
 * These combine primitives (offlineDb.ts, swSync.ts, auth.ts, StockConflictModal) each
 * already unit-tested individually, to verify they compose correctly end-to-end.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { db } from '../db.js';
import { mirrorTokens } from '../tokenStore.js';
import { queueSale, getPendingSales, resolveConflict, markStockConflict } from '../offlineDb.js';
import { runBackgroundSync } from '../swSync.js';
import { StockConflictModal, supportsBackgroundSync } from '../POSScreen.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  await db.pendingSales.clear();
  await db.pendingCustomers.clear();
  await db.customers.clear();
  await db.catalogItems.clear();
  await db.syncMeta.clear();
  await db.authTokens.clear();
  vi.restoreAllMocks();
});

describe('Cross-cutting: outage + mid-outage token expiry + reconnect', () => {
  it('syncs every queued sale exactly once, with exactly one token refresh, despite an expired token mid-batch', async () => {
    await mirrorTokens('stale-access', 'refresh-1');
    // Simulate several sales queued while offline, across a "multi-hour gap" (only the
    // token's staleness matters here, not wall-clock time).
    await queueSale({ sessionId: 1, total: 100 });
    await queueSale({ sessionId: 1, total: 200 });
    await queueSale({ sessionId: 1, total: 300 });
    const queuedOperationIds = (await getPendingSales()).map((s) => s.operationId);
    expect(new Set(queuedOperationIds).size).toBe(3); // sanity: distinct operationIds

    let refreshCalls = 0;
    let firstSaleAttempt = true;
    const submittedOperationIds: string[] = [];
    // The mirrored token is stale when the outage began; only the very first request against
    // it 401s (simulating the token finally expiring mid-outage) — the refresh it triggers
    // fixes every subsequent request in the batch.
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls++;
        return Promise.resolve(jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }));
      }
      if (firstSaleAttempt) {
        firstSaleAttempt = false;
        return Promise.resolve(jsonResponse(401, { error: 'expired' }));
      }
      const body = JSON.parse((init?.body as string) ?? '{}') as { operationId: string };
      submittedOperationIds.push(body.operationId);
      return Promise.resolve(jsonResponse(200, { data: { invoiceId: submittedOperationIds.length } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedSales).toBe(3);
    expect(await getPendingSales()).toEqual([]); // nothing left stuck or re-queued
    expect(refreshCalls).toBe(1); // one token refresh for the whole batch, not per-sale

    // Every originally-queued operationId was submitted, and none was submitted twice.
    expect(submittedOperationIds.sort()).toEqual(queuedOperationIds.sort());
    expect(new Set(submittedOperationIds).size).toBe(submittedOperationIds.length);
  });
});

describe('Cross-cutting: Background Sync unsupported-browser fallback', () => {
  it('feature-detects as unsupported when SyncManager is absent, without breaking the underlying sync path', async () => {
    const originalSyncManager = (window as unknown as { SyncManager?: unknown }).SyncManager;
    // Simulate a browser (e.g. Firefox/Safari) with no Background Sync support.
    delete (window as unknown as { SyncManager?: unknown }).SyncManager;

    expect(supportsBackgroundSync()).toBe(false);

    // The fallback claim: POSScreen's tab-open triggers (window 'online' listener) call the
    // exact same sync primitives as the service worker's Background Sync handler — there is
    // no separate/divergent code path that only "unsupported" browsers hit. Prove the shared
    // primitive still completes a sync correctly regardless of Background Sync support.
    await mirrorTokens('access-1', 'refresh-1');
    await queueSale({ sessionId: 1 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { invoiceId: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedSales).toBe(1);
    expect(await getPendingSales()).toEqual([]);

    if (originalSyncManager !== undefined) {
      (window as unknown as { SyncManager?: unknown }).SyncManager = originalSyncManager;
    }
  });
});

describe('Cross-cutting: stuck stock-conflict resolved via the OFFLINE-07 UI produces exactly one invoice', () => {
  it('adjusting a conflicting sale in StockConflictModal and syncing results in exactly one POST /pos/sales, under a fresh operationId', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    await queueSale({ sessionId: 1, lines: [{ itemId: 42, quantity: 5 }] });
    const [queued] = await getPendingSales();
    const originalOperationId = queued!.operationId;
    await markStockConflict(queued!.id!, { itemId: 42, available: 2, requested: 5 });

    render(
      <StockConflictModal
        conflicts={[{ ...queued!, status: 'stuck', conflict: { itemId: 42, available: 2, requested: 5 } }]}
        onResolve={(id, action) => void resolveConflict(id, action)}
        onClose={() => {}}
      />
    );
    await screen.findByText('Item #42');
    await new Promise((r) => setTimeout(r, 0)); // flush the item-name-lookup effect before interacting
    fireEvent.click(screen.getByText(/Adjust to 2 & retry/));

    // resolveConflict() runs asynchronously off the click handler — wait for the queue to
    // reflect the adjustment before syncing.
    await vi.waitFor(async () => {
      const [pending] = await getPendingSales();
      expect(pending?.status).toBe('pending');
    });

    const [adjusted] = await getPendingSales();
    expect(adjusted!.operationId).not.toBe(originalOperationId); // a dead operationId isn't reused
    expect((adjusted!.payload['lines'] as Array<{ quantity: number }>)[0]!.quantity).toBe(2);

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { invoiceId: 99 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runBackgroundSync();

    expect(result.syncedSales).toBe(1);
    expect(await getPendingSales()).toEqual([]); // exactly one final state: synced, not stuck or duplicated
    const salesCalls = fetchMock.mock.calls.filter(([url]) => (url as string).includes('/pos/sales'));
    expect(salesCalls).toHaveLength(1); // exactly one invoice submission, not zero or two
  });
});
