import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { tenants, suppliers, tdsEntries } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
import { TenantScopedDatabase } from '@erp/sdk';
import { TDSService } from '../domain/TDSService.js';

// Regression test for two live-QA findings (2026-07-17): GET /tds/26q 500'd on every call.
// Two stacked bugs in the same raw-sql query: (1) `period_month = ANY(${months}::INTEGER[])`
// is invalid — drizzle's sql tag expands a JS array into a parenthesized param list
// (`($4, $5, $6)`), and casting a parenthesized list to INTEGER[] is a Postgres syntax
// error; fixed to a plain `IN ${months}`. (2) the query selected `s.name`, but `suppliers`
// has no `name` column — it's `display_name`.

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('TDSService.get26QData', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let tenantId: number;
  let supplierId: number;
  let branchId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const suffix = Date.now();
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `TDS Test Tenant ${suffix}`,
        slug: `tds-test-${suffix}`,
        status: 'ACTIVE',
        contactEmail: `tds-test-${suffix}@example.com`,
      })
      .returning();
    tenantId = tenant!.id;
    branchId = 1;

    const [supplier] = await db
      .insert(suppliers)
      .values({
        tenantId,
        branchId,
        displayName: 'Test Contractor Pvt Ltd',
        supplierType: 'DOMESTIC',
        phone: '9876500000',
        pan: 'ABCDE1234F',
        createdBy: 0,
      })
      .returning();
    supplierId = supplier!.id;

    await db.insert(tdsEntries).values({
      tenantId,
      supplierId,
      paymentId: 1,
      tdsSection: '194C',
      taxableAmount: '50000.00',
      tdsRate: '2.00',
      tdsAmount: '1000.00',
      periodMonth: 5,
      periodYear: 2026,
      createdBy: 0,
    });
  });

  afterAll(async () => {
    await db.delete(tdsEntries).where(eq(tdsEntries.tenantId, tenantId));
    await db.delete(suppliers).where(inArray(suppliers.id, [supplierId]));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('returns real supplier names and amounts for a quarter with entries, without throwing', async () => {
    const tsDb = new TenantScopedDatabase(tenantId, db);
    const result = await TDSService.get26QData(tsDb, tenantId, 2026, 1);

    expect(result.period).toBe('2026-Q1');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      pan: 'ABCDE1234F',
      supplierName: 'Test Contractor Pvt Ltd',
      section: '194C',
      grossAmount: 50000,
      tdsAmount: 1000,
    });
  });

  it('returns an empty entries array (not an error) for a quarter with no entries', async () => {
    const tsDb = new TenantScopedDatabase(tenantId, db);
    const result = await TDSService.get26QData(tsDb, tenantId, 2026, 3);

    expect(result.entries).toHaveLength(0);
  });
});
