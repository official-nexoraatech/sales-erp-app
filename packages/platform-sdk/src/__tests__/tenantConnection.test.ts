// Multi-industry platform, Phase 9 (13-security-architecture.md §2 step 1) — proves the
// GUC-per-request fix against a real Postgres connection, not mocked: (1) app.current_tenant_id
// is correctly set for the duration of the callback, isolated per concurrent call; (2) it reverts
// on its own after commit (SET LOCAL semantics — no manual reset-before-release step exists to
// get wrong); (3) a nested this.db.transaction() call from inside the callback (the real shape
// every domain service uses, e.g. BOMService.create()) works as a savepoint rather than throwing
// — this is the exact case that broke the earlier sql.reserve()-based attempt.
import { describe, it, expect } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { sql } from 'drizzle-orm';
import { withTenantConnection } from '../tenantConnection.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('withTenantConnection — real Postgres', () => {
  it('sets app.current_tenant_id for the duration of the callback, isolated per concurrent call', async () => {
    const db = createDatabaseClient({ url: DB_URL!, maxConnections: 5 });
    const [valA, valB] = await Promise.all([
      withTenantConnection(db, 111, async (scopedDb) => {
        const [row] = (await scopedDb.execute(
          sql`SELECT current_setting('app.current_tenant_id', true) AS val`
        )) as unknown as { val: string }[];
        return row!.val;
      }),
      withTenantConnection(db, 222, async (scopedDb) => {
        const [row] = (await scopedDb.execute(
          sql`SELECT current_setting('app.current_tenant_id', true) AS val`
        )) as unknown as { val: string }[];
        return row!.val;
      }),
    ]);
    expect(valA).toBe('111');
    expect(valB).toBe('222');
  });

  it('SET LOCAL reverts on its own after commit — a later unrelated query never inherits it', async () => {
    // maxConnections: 1 forces the follow-up query onto the exact same physical connection,
    // making the leak check deterministic rather than dependent on pool luck.
    const db = createDatabaseClient({ url: DB_URL!, maxConnections: 1 });
    await withTenantConnection(db, 333, async (scopedDb) => {
      const [row] = (await scopedDb.execute(
        sql`SELECT current_setting('app.current_tenant_id', true) AS val`
      )) as unknown as { val: string }[];
      expect(row!.val).toBe('333');
    });

    const [afterRow] = (await db.execute(
      sql`SELECT current_setting('app.current_tenant_id', true) AS val`
    )) as unknown as { val: string }[];
    expect(afterRow!.val).toBe('');
  });

  it('rolls back on throw — no partial write survives', async () => {
    const db = createDatabaseClient({ url: DB_URL!, maxConnections: 2 });
    const TEST_TENANT = 999_888;
    await expect(
      withTenantConnection(db, TEST_TENANT, async (scopedDb) => {
        await scopedDb.execute(sql`CREATE TEMP TABLE IF NOT EXISTS guc_rollback_probe (x int)`);
        await scopedDb.execute(sql`INSERT INTO guc_rollback_probe VALUES (1)`);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // A TEMP TABLE only exists for the connection/session that created it — since the whole
    // callback (including the CREATE TEMP TABLE) rolled back, a fresh transaction on the same
    // pool must not see it.
    await expect(
      withTenantConnection(db, TEST_TENANT, async (scopedDb) => {
        await scopedDb.execute(sql`SELECT * FROM guc_rollback_probe`);
      })
    ).rejects.toThrow();
  });

  it('a nested this.db.transaction() call inside the callback works as a savepoint (the real BOMService.create() shape)', async () => {
    const db = createDatabaseClient({ url: DB_URL!, maxConnections: 2 });
    const result = await withTenantConnection(db, 444, async (scopedDb) => {
      return scopedDb.transaction(async (trx) => {
        const [row] = (await trx.execute(
          sql`SELECT current_setting('app.current_tenant_id', true) AS val`
        )) as unknown as { val: string }[];
        return row!.val;
      });
    });
    expect(result).toBe('444');
  });
});
