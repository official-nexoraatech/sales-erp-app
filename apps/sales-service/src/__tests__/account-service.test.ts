// CRM-ROADMAP Phase 1, Feature 1 (Contact & Account Hierarchy) — AccountService coverage:
// dedupe-match scoring (must not be 100%-confidence-only — a real graduated threshold, not a
// binary match/no-match), account merge (re-pointing, never dropping a balance), and the
// lazy implicit-account creation for a customer's first B2B-relevant action.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, crmAccounts, crmAccountContacts } from '@erp/db';
import { eq } from 'drizzle-orm';
import { AccountService } from '../domain/AccountService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('AccountService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_501 + Math.floor(Math.random() * 1000);
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
    await db.delete(crmAccountContacts).where(eq(crmAccountContacts.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(crmAccounts).where(eq(crmAccounts.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('findDuplicateCandidates', () => {
    it('true positive: a GSTIN match scores high and is surfaced', async () => {
      const gstinHash = 'GSTINHASH_TRUEPOSITIVE';
      await db.insert(crmAccounts).values({
        tenantId: TEST_TENANT,
        name: 'Sharma Textiles Pvt Ltd',
        accountType: 'B2B',
        gstinHash,
        primaryPhone: '9000001111',
        primaryEmail: 'accounts@sharmatextiles.example',
        createdBy: 1,
      });

      const candidates = await AccountService.findDuplicateCandidates(
        db,
        TEST_TENANT,
        { name: 'Sharma Textiles Pvt Ltd', gstin: 'ANYTHING' },
        gstinHash
      );

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]!.score).toBeGreaterThanOrEqual(70);
      expect(candidates[0]!.reasons.some((r) => r.toLowerCase().includes('gstin'))).toBe(true);
    });

    it('a weaker phone-only match is still suggested, but scored lower than a GSTIN match (not 100%-confidence-only)', async () => {
      await db.insert(crmAccounts).values({
        tenantId: TEST_TENANT,
        name: 'Verma Traders',
        accountType: 'WHOLESALE',
        primaryPhone: '9000002222',
        createdBy: 1,
      });

      const candidates = await AccountService.findDuplicateCandidates(
        db,
        TEST_TENANT,
        { name: 'A Completely Different Company Name', phone: '9000002222' },
        null
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0]!.score).toBe(40);
      expect(candidates[0]!.score).toBeLessThan(100);
    });

    it('true negative: unrelated gstin/phone/email never surfaces a candidate (not a full-scan match-everything)', async () => {
      const candidates = await AccountService.findDuplicateCandidates(
        db,
        TEST_TENANT,
        { name: 'Sharma Textiles Pvt Ltd', phone: '9999999999', email: 'nobody@nowhere.example' },
        'GSTINHASH_DOES_NOT_EXIST'
      );
      expect(candidates).toEqual([]);
    });
  });

  describe('merge', () => {
    it('re-points contacts and customers to the target, and marks the source merged without dropping balances', async () => {
      const [source] = await db
        .insert(crmAccounts)
        .values({ tenantId: TEST_TENANT, name: 'Source Co', accountType: 'B2B', createdBy: 1 })
        .returning();
      const [target] = await db
        .insert(crmAccounts)
        .values({ tenantId: TEST_TENANT, name: 'Target Co', accountType: 'B2B', createdBy: 1 })
        .returning();

      await db.insert(crmAccountContacts).values({
        tenantId: TEST_TENANT,
        accountId: source!.id,
        name: 'Billing Contact',
        role: 'BILLING',
        isPrimary: true,
        createdBy: 1,
      });

      const [customer] = await db
        .insert(customers)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          displayName: 'Source Co Customer',
          phone: '9000003333',
          creditLimit: '0',
          openingBalance: '15000.00',
          accountId: source!.id,
          createdBy: 1,
        })
        .returning();

      const result = await AccountService.merge(db, TEST_TENANT, source!.id, target!.id);
      expect(result.contactsMoved).toBe(1);
      expect(result.customersMoved).toBe(1);

      const [movedContact] = await db
        .select()
        .from(crmAccountContacts)
        .where(eq(crmAccountContacts.accountId, target!.id));
      expect(movedContact!.accountId).toBe(target!.id);
      // Primary is cleared on merge — the surviving account keeps whichever primary it had.
      expect(movedContact!.isPrimary).toBe(false);

      const [movedCustomer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customer!.id));
      expect(movedCustomer!.accountId).toBe(target!.id);
      // Balance lives on the customer row, untouched by the account-level merge.
      expect(movedCustomer!.openingBalance).toBe('15000.00');

      const [mergedSource] = await db
        .select()
        .from(crmAccounts)
        .where(eq(crmAccounts.id, source!.id));
      expect(mergedSource!.mergedIntoAccountId).toBe(target!.id);
    });
  });

  describe('getOrCreateForCustomer', () => {
    it('creates an implicit account for a B2B-typed customer on first call, and is idempotent on the second', async () => {
      const [customer] = await db
        .insert(customers)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          displayName: 'New Wholesale Buyer',
          phone: '9000004444',
          customerType: 'WHOLESALE',
          creditLimit: '0',
          openingBalance: '0',
          createdBy: 1,
        })
        .returning();

      const created = await AccountService.getOrCreateForCustomer(db, TEST_TENANT, 1, customer!.id);
      expect(created.isImplicit).toBe(true);
      expect(created.accountType).toBe('WHOLESALE');
      expect(created.name).toBe('New Wholesale Buyer');

      const [refetchedCustomer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customer!.id));
      expect(refetchedCustomer!.accountId).toBe(created.id);

      const again = await AccountService.getOrCreateForCustomer(db, TEST_TENANT, 1, customer!.id);
      expect(again.id).toBe(created.id);
    });
  });
});
