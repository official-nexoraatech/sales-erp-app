import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { accounts } from '@erp/db';
import { eq } from 'drizzle-orm';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Accounts integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_201 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    await db.delete(accounts).where(eq(accounts.tenantId, TEST_TENANT));
  });

  it('creates an account with the correct tenant scope', async () => {
    const [created] = await db
      .insert(accounts)
      .values({
        tenantId: TEST_TENANT,
        accountCode: 'CASH-001',
        accountName: 'Cash in Hand',
        accountType: 'ASSET',
        accountGroup: 'CURRENT_ASSETS',
        isSystem: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    expect(created).toBeDefined();
    expect(created!.tenantId).toBe(TEST_TENANT);
    expect(created!.accountCode).toBe('CASH-001');
    expect(created!.accountType).toBe('ASSET');
    expect(created!.version).toBe(0);
  });

  it('rejects duplicate account code within the same tenant', async () => {
    await db.insert(accounts).values({
      tenantId: TEST_TENANT,
      accountCode: 'DUP-001',
      accountName: 'First Account',
      accountType: 'ASSET',
      accountGroup: 'CURRENT_ASSETS',
      isSystem: false,
      isActive: true,
      createdBy: 1,
    });

    await expect(
      db.insert(accounts).values({
        tenantId: TEST_TENANT,
        accountCode: 'DUP-001',
        accountName: 'Duplicate Account',
        accountType: 'ASSET',
        accountGroup: 'CURRENT_ASSETS',
        isSystem: false,
        isActive: true,
        createdBy: 1,
      })
    ).rejects.toThrow();
  });

  it('allows the same account code across different tenants', async () => {
    const OTHER_TENANT = TEST_TENANT + 500;

    const [a] = await db
      .insert(accounts)
      .values({
        tenantId: TEST_TENANT,
        accountCode: 'CROSS-001',
        accountName: 'Tenant A Account',
        accountType: 'ASSET',
        accountGroup: 'CURRENT_ASSETS',
        isSystem: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    const [b] = await db
      .insert(accounts)
      .values({
        tenantId: OTHER_TENANT,
        accountCode: 'CROSS-001',
        accountName: 'Tenant B Account',
        accountType: 'ASSET',
        accountGroup: 'CURRENT_ASSETS',
        isSystem: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    expect(a!.accountCode).toBe(b!.accountCode);
    expect(a!.tenantId).not.toBe(b!.tenantId);

    await db.delete(accounts).where(eq(accounts.tenantId, OTHER_TENANT));
  });
});
