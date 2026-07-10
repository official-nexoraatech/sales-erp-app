/**
 * OFFLINE-05 — held-sale and customer CRUD backing the local-only park/resume flow and
 * offline customer search/creation. jsdom doesn't implement IndexedDB, so
 * 'fake-indexeddb/auto' installs a spec-compliant in-memory IndexedDB before any module
 * under test opens the database (same convention as offlineDb.test.ts).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import {
  upsertHeldSale, getHeldSaleById, getAllHeldSales, deleteHeldSale,
  upsertCustomers, getCustomerById, getAllCustomers, deleteCustomerById,
} from '../localStore.js';

beforeEach(async () => {
  await db.heldSales.clear();
  await db.customers.clear();
});

describe('OFFLINE-05 — held sales (local-only park/resume)', () => {
  it('a held sale persists and can be read back by id', async () => {
    const id = await upsertHeldSale({
      tenantId: 1,
      branchId: 2,
      cart: [{ itemId: 10, quantity: 2 }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const held = await getHeldSaleById(id);
    expect(held).toBeDefined();
    expect(held!.cart).toEqual([{ itemId: 10, quantity: 2 }]);
  });

  it('getAllHeldSales returns every parked sale', async () => {
    await upsertHeldSale({ tenantId: 1, branchId: 2, cart: [], createdAt: Date.now(), updatedAt: Date.now() });
    await upsertHeldSale({ tenantId: 1, branchId: 2, cart: [], createdAt: Date.now(), updatedAt: Date.now() });
    expect(await getAllHeldSales()).toHaveLength(2);
  });

  it('deleteHeldSale removes it — resume is a one-time operation, same as the online endpoint used to be', async () => {
    const id = await upsertHeldSale({ tenantId: 1, branchId: 2, cart: [], createdAt: Date.now(), updatedAt: Date.now() });
    await deleteHeldSale(id);
    expect(await getHeldSaleById(id)).toBeUndefined();
    expect(await getAllHeldSales()).toEqual([]);
  });

  it('survives being read back after being written in an earlier "session" (persistence across reload)', async () => {
    const id = await upsertHeldSale({ tenantId: 1, branchId: 2, cart: [{ itemId: 1, quantity: 1 }], createdAt: Date.now(), updatedAt: Date.now() });
    // Simulate an app reload: close and reopen the same on-disk Dexie database.
    await db.close();
    await db.open();
    const held = await getHeldSaleById(id);
    expect(held?.cart).toEqual([{ itemId: 1, quantity: 1 }]);
  });
});

describe('OFFLINE-05 — customer cache (offline search + local placeholder records)', () => {
  it('a locally-created (negative id) customer is searchable via getAllCustomers, same as a synced one', async () => {
    await upsertCustomers([{
      id: -1700000000000,
      tenantId: 1,
      branchId: 2,
      displayName: 'Walk-in Customer',
      phone: '9876543210',
      customerType: 'RETAIL',
      updatedAt: new Date().toISOString(),
    }]);
    const all = await getAllCustomers();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBeLessThan(0);
  });

  it('deleteCustomerById removes the placeholder once the real synced record replaces it', async () => {
    const localId = -1;
    await upsertCustomers([{ id: localId, tenantId: 1, branchId: 2, displayName: 'Walk-in', phone: '111', customerType: 'RETAIL', updatedAt: new Date().toISOString() }]);
    await deleteCustomerById(localId);
    await upsertCustomers([{ id: 501, tenantId: 1, branchId: 2, displayName: 'Walk-in', phone: '111', customerType: 'RETAIL', updatedAt: new Date().toISOString() }]);
    const all = await getAllCustomers();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(501);
  });

  it('getCustomerById finds a cached customer for held-sale resume', async () => {
    await upsertCustomers([{ id: 42, tenantId: 1, branchId: 2, displayName: 'Jane', phone: '222', customerType: 'RETAIL', updatedAt: new Date().toISOString() }]);
    const c = await getCustomerById(42);
    expect(c?.displayName).toBe('Jane');
  });
});
