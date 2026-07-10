import { db, type PendingSale, type PendingCustomer, type StockConflict } from './db.js';

export type { PendingSale, PendingCustomer, StockConflict };

// OFFLINE-02: after this many failed sync attempts, a queued sale stops retrying
// automatically and needs manual review (surfaced in the POS UI) rather than being
// retried forever silently on every future reconnect.
export const MAX_RETRIES = 5;

export async function queueSale(payload: Record<string, unknown>): Promise<void> {
  await db.pendingSales.add({
    payload,
    operationId: crypto.randomUUID(),
    createdAt: Date.now(),
    retries: 0,
    status: 'pending',
  });
}

export async function getPendingSales(): Promise<PendingSale[]> {
  return db.pendingSales.toArray();
}

export async function deletePendingSale(id: number): Promise<void> {
  await db.pendingSales.delete(id);
}

// Called on every failed sync attempt. Once a sale exceeds MAX_RETRIES it transitions to
// 'stuck' so syncPending() stops retrying it automatically.
export async function incrementRetries(id: number): Promise<void> {
  const record = await db.pendingSales.get(id);
  if (!record) return;
  const retries = record.retries + 1;
  const status = retries >= MAX_RETRIES ? 'stuck' : record.status;
  await db.pendingSales.update(id, { retries, status });
}

// OFFLINE-06: manual "retry stuck items" action — resets a stuck sale back to pending so
// the next sync attempt (tab-open or background) picks it up again instead of it being
// permanently excluded by the `status !== 'stuck'` filter every sync loop applies.
export async function resetStuckSale(id: number): Promise<void> {
  await db.pendingSales.update(id, { retries: 0, status: 'pending' });
}

// OFFLINE-07: a stock conflict is a deterministic business failure (the server already
// rejected this exact quantity) — retrying it unchanged would just fail again, so this
// jumps straight to 'stuck' with the conflict detail attached, instead of counting toward
// MAX_RETRIES like a transient network/auth failure would.
export async function markStockConflict(id: number, conflict: StockConflict): Promise<void> {
  await db.pendingSales.update(id, { status: 'stuck', conflict });
}

// OFFLINE-07: resolves a stock-conflict stuck sale. 'cancel' (or an adjust that would
// leave zero lines) removes it from the queue outright. 'adjust' clamps the conflicting
// line's quantity down to what's actually available and re-queues it as 'pending' under a
// *new* operationId — the original operationId's server-side invoice was already voided
// (see pos.routes.ts), so reusing it would just hit the dedup path against that dead
// record instead of submitting the adjusted sale.
export async function resolveConflict(id: number, action: 'adjust' | 'cancel'): Promise<'adjusted' | 'cancelled' | 'no-op'> {
  const record = await db.pendingSales.get(id);
  if (!record?.conflict) return 'no-op';

  if (action === 'cancel') {
    await deletePendingSale(id);
    return 'cancelled';
  }

  const { itemId, available } = record.conflict;
  const lines = (record.payload['lines'] as Array<Record<string, unknown>>)
    .map((l) => (l['itemId'] === itemId ? { ...l, quantity: available } : l))
    .filter((l) => (l['quantity'] as number) > 0);

  if (lines.length === 0) {
    await deletePendingSale(id);
    return 'cancelled';
  }

  // exactOptionalPropertyTypes forbids assigning `conflict: undefined` through Dexie's
  // UpdateSpec — put() a full record with the key deleted instead, so the stale conflict
  // doesn't linger in IndexedDB.
  const updated: PendingSale = {
    ...record,
    payload: { ...record.payload, lines },
    operationId: crypto.randomUUID(),
    retries: 0,
    status: 'pending',
  };
  delete updated.conflict;
  await db.pendingSales.put(updated);
  return 'adjusted';
}

// OFFLINE-05: a customer created offline is queued for sync the same way a sale is —
// client-generated operationId carried through every retry so the server (customer.routes.ts)
// can dedupe a repeated sync instead of creating a duplicate customer record.
export async function queueCustomer(payload: Record<string, unknown>, localCustomerId: number): Promise<void> {
  await db.pendingCustomers.add({
    payload,
    operationId: crypto.randomUUID(),
    localCustomerId,
    createdAt: Date.now(),
    retries: 0,
    status: 'pending',
  });
}

export async function getPendingCustomers(): Promise<PendingCustomer[]> {
  return db.pendingCustomers.toArray();
}

export async function deletePendingCustomer(id: number): Promise<void> {
  await db.pendingCustomers.delete(id);
}

export async function incrementCustomerRetries(id: number): Promise<void> {
  const record = await db.pendingCustomers.get(id);
  if (!record) return;
  const retries = record.retries + 1;
  const status = retries >= MAX_RETRIES ? 'stuck' : record.status;
  await db.pendingCustomers.update(id, { retries, status });
}

// OFFLINE-06: see resetStuckSale — same manual-retry reset for the customer queue.
export async function resetStuckCustomer(id: number): Promise<void> {
  await db.pendingCustomers.update(id, { retries: 0, status: 'pending' });
}

// After a queued customer syncs and gets its real server id, any other still-queued sale
// that referenced the old negative placeholder id must be rewritten to the real id —
// otherwise that sale's sync would submit a customerId that only ever existed locally
// and fail its foreign-key check on the server.
export async function rewritePendingSalesCustomerId(oldCustomerId: number, newCustomerId: number): Promise<void> {
  const all = await db.pendingSales.toArray();
  for (const sale of all) {
    if (sale.payload['customerId'] === oldCustomerId) {
      await db.pendingSales.update(sale.id!, { payload: { ...sale.payload, customerId: newCustomerId } });
    }
  }
}
