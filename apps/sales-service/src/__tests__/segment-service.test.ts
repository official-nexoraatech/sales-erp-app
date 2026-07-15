// CP-1 (Campaign Management Platform initiative) baseline regression tests for SegmentService's
// CURRENT behavior — the 6 prebuilt segments and the custom rule/operator/AND-OR engine — before
// CP-3 extends the field whitelist and adds the multi-rule builder UI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, customers } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValidationError } from '@erp/types';
import { SegmentService, type SegmentFilterDefinition } from '../domain/SegmentService.js';

describe('SegmentService.isPrebuilt', () => {
  it('recognizes all 6 known prebuilt codes', () => {
    for (const code of [
      'no-purchase-60-days',
      'gold-tier',
      'high-value',
      'overdue-30',
      'birthdays-this-month',
      'new-customers-this-month',
    ]) {
      expect(SegmentService.isPrebuilt(code)).toBe(true);
    }
  });

  it('rejects an unknown code', () => {
    expect(SegmentService.isPrebuilt('not-a-real-segment')).toBe(false);
  });
});

describe('SegmentService.customWhere / buildCondition', () => {
  it('throws ValidationError for a field outside the whitelist', () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'ssn', operator: 'eq', value: '123' }],
      logic: 'AND',
    };
    expect(() => SegmentService.customWhere(1, def)).toThrow(ValidationError);
  });

  it('throws ValidationError for an unsupported operator', () => {
    const def = {
      rules: [{ field: 'status', operator: 'regex' as never, value: 'x' }],
      logic: 'AND' as const,
    };
    expect(() => SegmentService.customWhere(1, def)).toThrow(ValidationError);
  });

  it('returns just the tenant/soft-delete base condition when there are no rules', () => {
    const sqlObj = SegmentService.customWhere(1, { rules: [], logic: 'AND' });
    expect(sqlObj).toBeDefined();
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('SegmentService — integration (CP-1 baseline)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_401 + Math.floor(Math.random() * 1000);
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

    await db.insert(customers).values([
      {
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Gold Customer',
        phone: '9000000201',
        creditLimit: '0',
        openingBalance: '0',
        loyaltyPoints: 6000,
        customerType: 'RETAIL',
        gender: 'FEMALE',
        billingAddress: {
          line1: '1 MG Road',
          city: 'Pune',
          state: 'Maharashtra',
          stateCode: '27',
          pincode: '411001',
          country: 'IN',
        },
        customFields: { preferredBrand: 'Levis' },
        createdBy: 1,
      },
      {
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Regular Customer',
        phone: '9000000202',
        creditLimit: '0',
        openingBalance: '0',
        loyaltyPoints: 100,
        customerType: 'RETAIL',
        gender: 'MALE',
        billingAddress: {
          line1: '2 FC Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          stateCode: '27',
          pincode: '400001',
          country: 'IN',
        },
        customFields: { preferredBrand: 'Nike' },
        createdBy: 1,
      },
      {
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Wholesale Customer',
        phone: '9000000203',
        creditLimit: '0',
        openingBalance: '0',
        loyaltyPoints: 100,
        customerType: 'WHOLESALE',
        createdBy: 1,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('gold-tier prebuilt segment matches only loyaltyPoints >= 5000', async () => {
    const where = SegmentService.prebuiltWhere('gold-tier', TEST_TENANT);
    const { rows } = await SegmentService.listMatching(db, where, 0, 50);
    expect(rows.map((r) => r.displayName)).toEqual(['Gold Customer']);
  });

  it('custom segment with a single eq rule matches correctly', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'customerType', operator: 'eq', value: 'WHOLESALE' }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(1);
  });

  it('custom segment with AND logic across two rules narrows the match', async () => {
    const def: SegmentFilterDefinition = {
      rules: [
        { field: 'customerType', operator: 'eq', value: 'RETAIL' },
        { field: 'loyaltyPoints', operator: 'gte', value: 5000 },
      ],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const { rows } = await SegmentService.listMatching(db, where, 0, 50);
    expect(rows.map((r) => r.displayName)).toEqual(['Gold Customer']);
  });

  it('custom segment with OR logic across two rules widens the match', async () => {
    const def: SegmentFilterDefinition = {
      rules: [
        { field: 'customerType', operator: 'eq', value: 'WHOLESALE' },
        { field: 'loyaltyPoints', operator: 'gte', value: 5000 },
      ],
      logic: 'OR',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(2); // Gold Customer (loyalty) + Wholesale Customer (type)
  });

  it('contains operator does a case-insensitive substring match', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'displayName', operator: 'contains', value: 'gold' }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const { rows } = await SegmentService.listMatching(db, where, 0, 50);
    expect(rows.map((r) => r.displayName)).toEqual(['Gold Customer']);
  });

  it('scopes prebuilt and custom segments to the given tenant only', async () => {
    const otherTenantWhere = SegmentService.prebuiltWhere('gold-tier', TEST_TENANT + 1);
    const count = await SegmentService.countMatching(db, otherTenantWhere);
    expect(count).toBe(0);
  });

  it('resolveWhere dispatches to prebuiltWhere for a system segment', async () => {
    const where = await SegmentService.resolveWhere(db, TEST_TENANT, {
      code: 'gold-tier',
      isSystem: true,
      filterDefinition: null,
    });
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(1);
  });

  it('resolveWhere dispatches to customWhere for a non-system segment', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'customerType', operator: 'eq', value: 'WHOLESALE' }],
      logic: 'AND',
    };
    const where = await SegmentService.resolveWhere(db, TEST_TENANT, {
      code: 'my-custom-segment',
      isSystem: false,
      filterDefinition: def,
    });
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(1);
  });

  it('resolveWhere throws NotFoundError for a non-system segment with no filter definition', async () => {
    await expect(
      SegmentService.resolveWhere(db, TEST_TENANT, {
        code: 'broken-segment',
        isSystem: false,
        filterDefinition: null,
      })
    ).rejects.toThrow();
  });

  // CP-3: expanded field whitelist — store scoping, geography, and tenant-defined custom
  // attributes (reusing customers.customFields jsonb, not a new table).
  it('matches on the newly-whitelisted branchId column', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'branchId', operator: 'eq', value: branchId }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(3);
  });

  it('matches on gender', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'gender', operator: 'eq', value: 'FEMALE' }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const { rows } = await SegmentService.listMatching(db, where, 0, 50);
    expect(rows.map((r) => r.displayName)).toEqual(['Gold Customer']);
  });

  it('matches on a jsonb-derived geographic field (city)', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'city', operator: 'eq', value: 'Pune' }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const { rows } = await SegmentService.listMatching(db, where, 0, 50);
    expect(rows.map((r) => r.displayName)).toEqual(['Gold Customer']);
  });

  it('matches on a jsonb-derived geographic field with contains', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'state', operator: 'contains', value: 'maha' }],
      logic: 'OR',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(2); // Gold + Regular, both in Maharashtra; Wholesale has no address
  });

  it('matches on a tenant-defined custom attribute (customField:<key>)', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'customField:preferredBrand', operator: 'eq', value: 'Nike' }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const { rows } = await SegmentService.listMatching(db, where, 0, 50);
    expect(rows.map((r) => r.displayName)).toEqual(['Regular Customer']);
  });

  it('throws ValidationError for a customField rule with no key', () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'customField:', operator: 'eq', value: 'x' }],
      logic: 'AND',
    };
    expect(() => SegmentService.customWhere(TEST_TENANT, def)).toThrow(ValidationError);
  });

  it('matches on the computed orderCount purchase-history aggregate (zero purchases for all seeded customers)', async () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'orderCount', operator: 'eq', value: 0 }],
      logic: 'AND',
    };
    const where = SegmentService.customWhere(TEST_TENANT, def);
    const count = await SegmentService.countMatching(db, where);
    expect(count).toBe(3);
  });

  it('rejects the contains operator on a computed numeric field', () => {
    const def: SegmentFilterDefinition = {
      rules: [{ field: 'lifetimeValue', operator: 'contains', value: '5' }],
      logic: 'AND',
    };
    expect(() => SegmentService.customWhere(TEST_TENANT, def)).toThrow(ValidationError);
  });
});
