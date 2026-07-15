import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { customers, branches, customerCommunicationPreferences } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { encryptField } from '@erp/utils/server';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Customer integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_101 + Math.floor(Math.random() * 1000);
  let branchId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    branchId = branch!.id;
  });

  afterAll(async () => {
    await db
      .delete(customerCommunicationPreferences)
      .where(eq(customerCommunicationPreferences.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('creates a customer with the correct tenant scope', async () => {
    const [created] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Ramesh Textiles',
        phone: '9876543210',
        email: 'ramesh@example.com',
        creditLimit: '50000.00',
        openingBalance: '0.00',
        createdBy: 1,
      })
      .returning();

    expect(created).toBeDefined();
    expect(created!.tenantId).toBe(TEST_TENANT);
    expect(created!.displayName).toBe('Ramesh Textiles');
    expect(created!.version).toBe(0);
  });

  it('stores GSTIN as encrypted ciphertext', async () => {
    const encKey = process.env['FIELD_ENCRYPTION_KEY'] ?? '0'.repeat(64);
    const plainGstin = '27AAPFU0939F1ZV';
    const cipherGstin = encryptField(plainGstin, encKey);

    const [created] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'GST Test Customer',
        phone: '9000000001',
        gstin: cipherGstin,
        creditLimit: '0.00',
        openingBalance: '0.00',
        createdBy: 1,
      })
      .returning();

    // Stored value must not equal the plaintext
    expect(created!.gstin).not.toBe(plainGstin);
    expect(created!.gstin).toBe(cipherGstin);
  });

  it('enforces optimistic locking on update', async () => {
    const [created] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Lock Test Customer',
        phone: '9000000002',
        creditLimit: '0.00',
        openingBalance: '0.00',
        createdBy: 1,
      })
      .returning();

    // Stale version
    const stale = await db
      .update(customers)
      .set({ displayName: 'Should Not Update', version: 1 })
      .where(
        and(
          eq(customers.id, created!.id),
          eq(customers.tenantId, TEST_TENANT),
          eq(customers.version, 5)
        )
      )
      .returning();

    expect(stale).toHaveLength(0);

    // Correct version
    const [updated] = await db
      .update(customers)
      .set({ displayName: 'Updated Customer', version: 1 })
      .where(
        and(
          eq(customers.id, created!.id),
          eq(customers.tenantId, TEST_TENANT),
          eq(customers.version, 0)
        )
      )
      .returning();

    expect(updated!.displayName).toBe('Updated Customer');
    expect(updated!.version).toBe(1);
  });

  // CP-7 follow-up: granular consent model (customer_communication_preferences), additive to
  // the binary optOutSms/Whatsapp/Email flags tested elsewhere — verifies the route's
  // insert-or-update-on-conflict logic against the table's real unique constraint
  // (tenant_id, customer_id, channel, category).
  describe('customer_communication_preferences upsert', () => {
    it('inserts a new preference row, then updates the same row on a repeat upsert (no duplicate)', async () => {
      const [customer] = await db
        .insert(customers)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          displayName: 'Preferences Test Customer',
          phone: '9000000010',
          creditLimit: '0.00',
          openingBalance: '0.00',
          createdBy: 1,
        })
        .returning();

      const [inserted] = await db
        .insert(customerCommunicationPreferences)
        .values({
          tenantId: TEST_TENANT,
          customerId: customer!.id,
          channel: 'EMAIL',
          category: 'PROMOTIONAL',
          consented: true,
          consentSource: 'ADMIN_UPDATE',
        })
        .onConflictDoUpdate({
          target: [
            customerCommunicationPreferences.tenantId,
            customerCommunicationPreferences.customerId,
            customerCommunicationPreferences.channel,
            customerCommunicationPreferences.category,
          ],
          set: { consented: true },
        })
        .returning();
      expect(inserted!.consented).toBe(true);

      const [updated] = await db
        .insert(customerCommunicationPreferences)
        .values({
          tenantId: TEST_TENANT,
          customerId: customer!.id,
          channel: 'EMAIL',
          category: 'PROMOTIONAL',
          consented: false,
          consentSource: 'ADMIN_UPDATE',
        })
        .onConflictDoUpdate({
          target: [
            customerCommunicationPreferences.tenantId,
            customerCommunicationPreferences.customerId,
            customerCommunicationPreferences.channel,
            customerCommunicationPreferences.category,
          ],
          set: { consented: false },
        })
        .returning();
      expect(updated!.id).toBe(inserted!.id);
      expect(updated!.consented).toBe(false);

      const rows = await db
        .select()
        .from(customerCommunicationPreferences)
        .where(eq(customerCommunicationPreferences.customerId, customer!.id));
      expect(rows).toHaveLength(1);
    });

    it('keeps independent rows per (channel, category) pair for the same customer', async () => {
      const [customer] = await db
        .insert(customers)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          displayName: 'Multi-Preference Customer',
          phone: '9000000011',
          creditLimit: '0.00',
          openingBalance: '0.00',
          createdBy: 1,
        })
        .returning();

      await db.insert(customerCommunicationPreferences).values([
        {
          tenantId: TEST_TENANT,
          customerId: customer!.id,
          channel: 'EMAIL',
          category: 'PROMOTIONAL',
          consented: false,
        },
        {
          tenantId: TEST_TENANT,
          customerId: customer!.id,
          channel: 'EMAIL',
          category: 'TRANSACTIONAL',
          consented: true,
        },
        {
          tenantId: TEST_TENANT,
          customerId: customer!.id,
          channel: 'SMS',
          category: 'PROMOTIONAL',
          consented: false,
        },
      ]);

      const rows = await db
        .select()
        .from(customerCommunicationPreferences)
        .where(eq(customerCommunicationPreferences.customerId, customer!.id));
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.category === 'TRANSACTIONAL')?.consented).toBe(true);
    });
  });
});
