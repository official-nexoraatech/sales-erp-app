// Verifies the exact mechanism the "move audit.log() inside the transaction" fix
// (accounting-service's post-hoc-audit-log routes) depends on: once a handler is wrapped in
// withTenantConnection/tenantScopedHandler, a domain service's own internal db.transaction()
// call becomes a SAVEPOINT of the outer transaction, not an independently-durable commit — so if
// something else in the SAME outer transaction fails afterward (e.g. an audit-log write), the
// savepoint's insert is rolled back too, even though the inner .transaction() call itself already
// returned successfully. This is the opposite of today's pre-migration behavior (where the
// service's own .transaction() call against the pool-level db commits for real, immediately,
// independent of whatever the route does next) — must be proven, not assumed, before relying on
// it for financial-code migrations.
import { describe, it, expect } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches } from '@erp/db';
import { eq } from 'drizzle-orm';
import { withTenantConnection } from '../tenantConnection.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('nested transaction becomes a rollback-able savepoint', () => {
  const TEST_TENANT = 908_001 + Math.floor(Math.random() * 1000);

  it('an inner db.transaction() call that already returned is still rolled back if the outer one fails afterward', async () => {
    const db = createDatabaseClient({ url: DB_URL!, maxConnections: 2 });

    await expect(
      withTenantConnection(db, TEST_TENANT, async (scopedDb) => {
        // Simulates a domain service method that opens its own transaction and returns
        // successfully — e.g. CostCenterService.create()'s own internal db.transaction().
        await scopedDb.transaction(async (trx) => {
          await trx.insert(branches).values({
            tenantId: TEST_TENANT,
            name: 'Savepoint Probe Branch',
            code: 'SPB',
            isHeadOffice: true,
            isActive: true,
            createdBy: 1,
          });
        });
        // At this point, pre-migration (no outer transaction), the insert above would already
        // be permanently committed. Post-migration, it's merely a savepoint pending the outer
        // transaction's own fate. Simulate the "audit.log() write fails" case:
        throw new Error('simulated audit-log failure');
      })
    ).rejects.toThrow('simulated audit-log failure');

    // Prove the insert did NOT survive, from a completely fresh, independent connection.
    const rows = await db.select().from(branches).where(eq(branches.tenantId, TEST_TENANT));
    expect(rows).toHaveLength(0);
  });

  it('control: the same nested transaction DOES persist when the outer callback succeeds', async () => {
    const db = createDatabaseClient({ url: DB_URL!, maxConnections: 2 });

    await withTenantConnection(db, TEST_TENANT, async (scopedDb) => {
      await scopedDb.transaction(async (trx) => {
        await trx.insert(branches).values({
          tenantId: TEST_TENANT,
          name: 'Savepoint Probe Branch 2',
          code: 'SPB2',
          isHeadOffice: true,
          isActive: true,
          createdBy: 1,
        });
      });
      // No error this time — the outer transaction commits normally.
    });

    const rows = await db.select().from(branches).where(eq(branches.tenantId, TEST_TENANT));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('SPB2');

    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });
});
