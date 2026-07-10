/**
 * OFFLINE-02/03 — offlineDb.ts's queueSale/incrementRetries/stuck-state behavior, now
 * running on Dexie. jsdom doesn't implement IndexedDB, so 'fake-indexeddb/auto' installs
 * a spec-compliant in-memory IndexedDB (including versionchange/upgrade support, which
 * Dexie relies on) before any module under test opens the database.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import {
  queueSale, getPendingSales, incrementRetries, deletePendingSale, MAX_RETRIES,
  queueCustomer, getPendingCustomers, deletePendingCustomer, incrementCustomerRetries, rewritePendingSalesCustomerId,
  resetStuckSale, resetStuckCustomer, markStockConflict, resolveConflict,
} from '../offlineDb.js';

beforeEach(async () => {
  await db.pendingSales.clear();
  await db.catalogItems.clear();
  await db.customers.clear();
  await db.priceListItems.clear();
  await db.taxRates.clear();
  await db.heldSales.clear();
  await db.syncMeta.clear();
  await db.pendingCustomers.clear();
  await db.authTokens.clear();
});

describe('OFFLINE-02 — offlineDb.ts', () => {
  it('queueSale attaches a stable operationId and starts at retries: 0, status: pending', async () => {
    await queueSale({ sessionId: 1 });
    const [sale] = await getPendingSales();
    expect(sale!.operationId).toEqual(expect.any(String));
    expect(sale!.operationId.length).toBeGreaterThan(0);
    expect(sale!.retries).toBe(0);
    expect(sale!.status).toBe('pending');
  });

  it('two queued sales get different operationIds', async () => {
    await queueSale({ sessionId: 1 });
    await queueSale({ sessionId: 2 });
    const pending = await getPendingSales();
    expect(pending[0]!.operationId).not.toBe(pending[1]!.operationId);
  });

  it('incrementRetries increments the counter and preserves the operationId', async () => {
    await queueSale({ sessionId: 1 });
    const [sale] = await getPendingSales();
    await incrementRetries(sale!.id!);
    const [updated] = await getPendingSales();
    expect(updated!.retries).toBe(1);
    expect(updated!.operationId).toBe(sale!.operationId);
    expect(updated!.status).toBe('pending');
  });

  it('transitions to "stuck" once retries reaches MAX_RETRIES, and stays stuck on further failures', async () => {
    await queueSale({ sessionId: 1 });
    const [sale] = await getPendingSales();
    for (let i = 0; i < MAX_RETRIES; i++) {
      await incrementRetries(sale!.id!);
    }
    const [afterMax] = await getPendingSales();
    expect(afterMax!.retries).toBe(MAX_RETRIES);
    expect(afterMax!.status).toBe('stuck');

    await incrementRetries(sale!.id!);
    const [afterOneMore] = await getPendingSales();
    expect(afterOneMore!.status).toBe('stuck');
    expect(afterOneMore!.retries).toBe(MAX_RETRIES + 1);
  });

  it('deletePendingSale removes the record', async () => {
    await queueSale({ sessionId: 1 });
    const [sale] = await getPendingSales();
    await deletePendingSale(sale!.id!);
    expect(await getPendingSales()).toEqual([]);
  });

  it('resetStuckSale — OFFLINE-06 manual retry — clears retries and status back to pending', async () => {
    await queueSale({ sessionId: 1 });
    const [sale] = await getPendingSales();
    for (let i = 0; i < MAX_RETRIES; i++) {
      await incrementRetries(sale!.id!);
    }
    expect((await getPendingSales())[0]!.status).toBe('stuck');

    await resetStuckSale(sale!.id!);
    const [reset] = await getPendingSales();
    expect(reset!.status).toBe('pending');
    expect(reset!.retries).toBe(0);
    expect(reset!.operationId).toBe(sale!.operationId);
  });
});

describe('OFFLINE-07 — stock-conflict resolution', () => {
  it('markStockConflict jumps straight to stuck with the conflict detail attached, regardless of retry count', async () => {
    await queueSale({ sessionId: 1, lines: [{ itemId: 7, quantity: 5 }] });
    const [sale] = await getPendingSales();
    await markStockConflict(sale!.id!, { itemId: 7, available: 2, requested: 5 });
    const [updated] = await getPendingSales();
    expect(updated!.status).toBe('stuck');
    expect(updated!.conflict).toEqual({ itemId: 7, available: 2, requested: 5 });
  });

  it('resolveConflict("adjust") clamps the conflicting line to available qty, assigns a new operationId, and resets to pending', async () => {
    await queueSale({ sessionId: 1, lines: [{ itemId: 7, quantity: 5 }, { itemId: 9, quantity: 2 }] });
    const [sale] = await getPendingSales();
    const originalOperationId = sale!.operationId;
    await markStockConflict(sale!.id!, { itemId: 7, available: 2, requested: 5 });

    const outcome = await resolveConflict(sale!.id!, 'adjust');
    expect(outcome).toBe('adjusted');

    const [resolved] = await getPendingSales();
    expect(resolved!.status).toBe('pending');
    expect(resolved!.retries).toBe(0);
    expect(resolved!.conflict).toBeUndefined();
    expect(resolved!.operationId).not.toBe(originalOperationId);
    expect(resolved!.payload['lines']).toEqual([{ itemId: 7, quantity: 2 }, { itemId: 9, quantity: 2 }]);
  });

  it('resolveConflict("adjust") cancels the sale outright if the conflicting line was the only one and available is 0', async () => {
    await queueSale({ sessionId: 1, lines: [{ itemId: 7, quantity: 5 }] });
    const [sale] = await getPendingSales();
    await markStockConflict(sale!.id!, { itemId: 7, available: 0, requested: 5 });

    const outcome = await resolveConflict(sale!.id!, 'adjust');
    expect(outcome).toBe('cancelled');
    expect(await getPendingSales()).toEqual([]);
  });

  it('resolveConflict("cancel") removes the sale from the queue', async () => {
    await queueSale({ sessionId: 1, lines: [{ itemId: 7, quantity: 5 }] });
    const [sale] = await getPendingSales();
    await markStockConflict(sale!.id!, { itemId: 7, available: 2, requested: 5 });

    const outcome = await resolveConflict(sale!.id!, 'cancel');
    expect(outcome).toBe('cancelled');
    expect(await getPendingSales()).toEqual([]);
  });

  it('resolveConflict is a no-op on a sale without a conflict', async () => {
    await queueSale({ sessionId: 1, lines: [{ itemId: 7, quantity: 5 }] });
    const [sale] = await getPendingSales();
    const outcome = await resolveConflict(sale!.id!, 'adjust');
    expect(outcome).toBe('no-op');
    expect((await getPendingSales())[0]!.status).toBe('pending');
  });
});

describe('OFFLINE-05 — offlineDb.ts customer queue', () => {
  it('queueCustomer attaches a stable operationId and localCustomerId, starts at retries: 0, status: pending', async () => {
    await queueCustomer({ displayName: 'Walk-in', phone: '9876543210' }, -12345);
    const [pending] = await getPendingCustomers();
    expect(pending!.operationId).toEqual(expect.any(String));
    expect(pending!.localCustomerId).toBe(-12345);
    expect(pending!.retries).toBe(0);
    expect(pending!.status).toBe('pending');
  });

  it('incrementCustomerRetries transitions to "stuck" once retries reaches MAX_RETRIES', async () => {
    await queueCustomer({ displayName: 'Walk-in', phone: '9876543210' }, -1);
    const [pending] = await getPendingCustomers();
    for (let i = 0; i < MAX_RETRIES; i++) {
      await incrementCustomerRetries(pending!.id!);
    }
    const [afterMax] = await getPendingCustomers();
    expect(afterMax!.retries).toBe(MAX_RETRIES);
    expect(afterMax!.status).toBe('stuck');
  });

  it('deletePendingCustomer removes the record', async () => {
    await queueCustomer({ displayName: 'Walk-in', phone: '9876543210' }, -1);
    const [pending] = await getPendingCustomers();
    await deletePendingCustomer(pending!.id!);
    expect(await getPendingCustomers()).toEqual([]);
  });

  it('resetStuckCustomer — OFFLINE-06 manual retry — clears retries and status back to pending', async () => {
    await queueCustomer({ displayName: 'Walk-in', phone: '9876543210' }, -1);
    const [pending] = await getPendingCustomers();
    for (let i = 0; i < MAX_RETRIES; i++) {
      await incrementCustomerRetries(pending!.id!);
    }
    expect((await getPendingCustomers())[0]!.status).toBe('stuck');

    await resetStuckCustomer(pending!.id!);
    const [reset] = await getPendingCustomers();
    expect(reset!.status).toBe('pending');
    expect(reset!.retries).toBe(0);
  });

  it('rewritePendingSalesCustomerId patches only the matching queued sale, leaving others untouched', async () => {
    await queueSale({ sessionId: 1, customerId: -999 });
    await queueSale({ sessionId: 2, customerId: -888 });
    await rewritePendingSalesCustomerId(-999, 5001);
    const pending = await getPendingSales();
    const bySession = new Map(pending.map((p) => [p.payload['sessionId'], p.payload['customerId']]));
    expect(bySession.get(1)).toBe(5001);
    expect(bySession.get(2)).toBe(-888);
  });
});

describe('OFFLINE-03 — Dexie database', () => {
  it('opens successfully on a fresh profile with all tables present', async () => {
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['authTokens', 'catalogItems', 'customers', 'heldSales', 'pendingCustomers', 'pendingSales', 'priceListItems', 'syncMeta', 'taxRates'].sort()
    );
  });

  it('migrates pre-existing raw-IndexedDB pending_sales rows into the pendingSales table on upgrade', async () => {
    // Simulate a device that already has OFFLINE-02-era queued sales in the old
    // raw-IndexedDB store, written before this device ever opens the Dexie-based build.
    await db.close();
    indexedDB.deleteDatabase('pos-offline');

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('pos-offline', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('pending_sales', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('pending_sales', 'readwrite');
        tx.objectStore('pending_sales').add({
          payload: { sessionId: 99 },
          operationId: 'legacy-op-1',
          createdAt: Date.now(),
          retries: 0,
          status: 'pending',
        });
        tx.oncomplete = () => { idb.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    await db.open();
    const pending = await getPendingSales();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.operationId).toBe('legacy-op-1');
  });
});
