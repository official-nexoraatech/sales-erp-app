// CP-1 (Campaign Management Platform initiative) baseline regression tests for SegmentService's
// CURRENT behavior — the 6 prebuilt segments and the custom rule/operator/AND-OR engine — before
// CP-3 extends the field whitelist and adds the multi-rule builder UI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, categories, items, invoices, invoiceLines } from '@erp/db';
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

  // CRM-ROADMAP Phase 2, Feature 7 (Advanced Segmentation Engine) — behavioral/RFM operators.
  // Uses its own tenant and its own customers/purchases entirely, so none of the invoice data
  // seeded here can ever affect the CP-1/CP-3 assertions above (e.g. "orderCount == 0 matches
  // all 3 seeded customers") — this feature's own DoD requires proving existing segments are
  // provably unaffected, so isolation here is deliberate, not incidental.
  describe('behavioral / RFM operators', () => {
    const BEHAVIORAL_TENANT = 900_451 + Math.floor(Math.random() * 1000);
    let behavioralBranchId: number;
    let fabricsCategoryId: number;
    let recentBuyerId: number;
    let noRecentPurchaseId: number;

    beforeAll(async () => {
      const [branch] = await db
        .insert(branches)
        .values({
          tenantId: BEHAVIORAL_TENANT,
          name: 'Test HO',
          code: 'HO',
          isHeadOffice: true,
          isActive: true,
          createdBy: 1,
        })
        .returning();
      behavioralBranchId = branch!.id;

      const [category] = await db
        .insert(categories)
        .values({ tenantId: BEHAVIORAL_TENANT, name: 'Fabrics', createdBy: 1 })
        .returning();
      fabricsCategoryId = category!.id;

      const [item] = await db
        .insert(items)
        .values({
          tenantId: BEHAVIORAL_TENANT,
          name: 'Cotton Fabric',
          unitId: 1,
          hsnCode: '5208',
          categoryId: fabricsCategoryId,
          createdBy: 1,
        })
        .returning();

      const [recentBuyer] = await db
        .insert(customers)
        .values({
          tenantId: BEHAVIORAL_TENANT,
          branchId: behavioralBranchId,
          displayName: 'Recent Fabric Buyer',
          phone: '9600000301',
          dateOfBirth: '1990-06-15',
          creditLimit: '0',
          openingBalance: '0',
          customerType: 'RETAIL',
          createdBy: 1,
        })
        .returning();
      recentBuyerId = recentBuyer!.id;

      const [noPurchase] = await db
        .insert(customers)
        .values({
          tenantId: BEHAVIORAL_TENANT,
          branchId: behavioralBranchId,
          displayName: 'No Recent Purchase',
          phone: '9600000302',
          dateOfBirth: '1990-06-20',
          creditLimit: '0',
          openingBalance: '0',
          customerType: 'RETAIL',
          createdBy: 1,
        })
        .returning();
      noRecentPurchaseId = noPurchase!.id;

      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId: BEHAVIORAL_TENANT,
          branchId: behavioralBranchId,
          warehouseId: behavioralBranchId,
          customerId: recentBuyerId,
          invoiceNumber: `SEG-TEST-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: 'CONFIRMED',
          subtotal: '500',
          taxableAmount: '500',
          grandTotal: '500',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert)
        .returning();

      await db.insert(invoiceLines).values({
        invoiceId: invoice!.id,
        tenantId: BEHAVIORAL_TENANT,
        lineNumber: 1,
        itemId: item!.id,
        quantity: '2',
        unitPrice: '250',
        taxableAmount: '500',
        lineTotal: '500',
      } as unknown as typeof invoiceLines.$inferInsert);
    });

    afterAll(async () => {
      await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, BEHAVIORAL_TENANT));
      await db.delete(invoices).where(eq(invoices.tenantId, BEHAVIORAL_TENANT));
      await db.delete(items).where(eq(items.tenantId, BEHAVIORAL_TENANT));
      await db.delete(categories).where(eq(categories.tenantId, BEHAVIORAL_TENANT));
      await db.delete(customers).where(eq(customers.tenantId, BEHAVIORAL_TENANT));
      await db.delete(branches).where(eq(branches.tenantId, BEHAVIORAL_TENANT));
    });

    describe('purchased_category', () => {
      it('matches a customer who purchased in the category within the window', async () => {
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'purchases',
              operator: 'purchased_category',
              value: { categoryId: fabricsCategoryId, withinDays: 90 },
            },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.displayName)).toEqual(['Recent Fabric Buyer']);
      });

      it('excludes a customer with no purchase in the category', async () => {
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'purchases',
              operator: 'purchased_category',
              value: { categoryId: fabricsCategoryId, withinDays: 90 },
            },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.id)).not.toContain(noRecentPurchaseId);
      });

      it('degrades gracefully (still matches, does not crash) when the referenced category is later soft-deleted', async () => {
        await db
          .update(categories)
          .set({ deletedAt: new Date() })
          .where(eq(categories.id, fabricsCategoryId));
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'purchases',
              operator: 'purchased_category',
              value: { categoryId: fabricsCategoryId },
            },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.displayName)).toEqual(['Recent Fabric Buyer']);
        await db
          .update(categories)
          .set({ deletedAt: null })
          .where(eq(categories.id, fabricsCategoryId));
      });

      it('throws ValidationError when categoryId is missing', () => {
        const def: SegmentFilterDefinition = {
          rules: [{ field: 'purchases', operator: 'purchased_category', value: {} }],
          logic: 'AND',
        };
        expect(() => SegmentService.customWhere(BEHAVIORAL_TENANT, def)).toThrow(ValidationError);
      });
    });

    describe('between_dates — inclusive-boundary correctness', () => {
      it('includes a customer whose date falls exactly ON the from/to boundary (inclusive-inclusive)', async () => {
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'dateOfBirth',
              operator: 'between_dates',
              value: { from: '1990-06-15', to: '1990-06-15' },
            },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.displayName)).toEqual(['Recent Fabric Buyer']);
      });

      it('excludes a customer whose date falls one day outside the range', async () => {
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'dateOfBirth',
              operator: 'between_dates',
              value: { from: '1990-06-16', to: '1990-06-19' },
            },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const count = await SegmentService.countMatching(db, where);
        expect(count).toBe(0);
      });

      it('rejects a non-date field', () => {
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'loyaltyPoints',
              operator: 'between_dates',
              value: { from: '2020-01-01', to: '2020-12-31' },
            },
          ],
          logic: 'AND',
        };
        expect(() => SegmentService.customWhere(BEHAVIORAL_TENANT, def)).toThrow(ValidationError);
      });
    });

    describe('rfm_score', () => {
      it('matches on minFrequency (order count)', async () => {
        const def: SegmentFilterDefinition = {
          rules: [{ field: 'rfm', operator: 'rfm_score', value: { minFrequency: 1 } }],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.displayName)).toEqual(['Recent Fabric Buyer']);
      });

      it('matches on minMonetary (lifetime value) and excludes a customer below the threshold', async () => {
        const def: SegmentFilterDefinition = {
          rules: [{ field: 'rfm', operator: 'rfm_score', value: { minMonetary: 400 } }],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const count = await SegmentService.countMatching(db, where);
        expect(count).toBe(1);
      });

      it('combines maxRecencyDays + minFrequency + minMonetary with AND semantics', async () => {
        const def: SegmentFilterDefinition = {
          rules: [
            {
              field: 'rfm',
              operator: 'rfm_score',
              value: { maxRecencyDays: 30, minFrequency: 1, minMonetary: 400 },
            },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.displayName)).toEqual(['Recent Fabric Buyer']);
      });

      it('throws ValidationError when no threshold is provided', () => {
        const def: SegmentFilterDefinition = {
          rules: [{ field: 'rfm', operator: 'rfm_score', value: {} }],
          logic: 'AND',
        };
        expect(() => SegmentService.customWhere(BEHAVIORAL_TENANT, def)).toThrow(ValidationError);
      });
    });

    describe('a static and a behavioral operator combined in the same AND/OR tree', () => {
      it('evaluates both correctly together, not as incompatible', async () => {
        const def: SegmentFilterDefinition = {
          rules: [
            { field: 'customerType', operator: 'eq', value: 'RETAIL' },
            { field: 'rfm', operator: 'rfm_score', value: { minFrequency: 1 } },
          ],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);
        const { rows } = await SegmentService.listMatching(db, where, 0, 50);
        expect(rows.map((r) => r.displayName)).toEqual(['Recent Fabric Buyer']);
      });
    });

    describe('needsMembershipCache', () => {
      it('is false for a purely static-field segment', () => {
        expect(
          SegmentService.needsMembershipCache({
            rules: [{ field: 'status', operator: 'eq', value: 'ACTIVE' }],
            logic: 'AND',
          })
        ).toBe(false);
      });

      it('is false for between_dates (cheap indexed comparison, not cached)', () => {
        expect(
          SegmentService.needsMembershipCache({
            rules: [
              {
                field: 'dateOfBirth',
                operator: 'between_dates',
                value: { from: '2020-01-01', to: '2020-12-31' },
              },
            ],
            logic: 'AND',
          })
        ).toBe(false);
      });

      it('is true for a segment using purchased_category or rfm_score', () => {
        expect(
          SegmentService.needsMembershipCache({
            rules: [
              { field: 'purchases', operator: 'purchased_category', value: { categoryId: 1 } },
            ],
            logic: 'AND',
          })
        ).toBe(true);
        expect(
          SegmentService.needsMembershipCache({
            rules: [{ field: 'rfm', operator: 'rfm_score', value: { minFrequency: 1 } }],
            logic: 'AND',
          })
        ).toBe(true);
      });
    });

    describe('refreshMembershipCache / getCachedMembership — nightly refresh matches a live query', () => {
      it('produces the exact same membership the live query returns', async () => {
        const segmentId = 88_000_001 + Math.floor(Math.random() * 1000);
        const def: SegmentFilterDefinition = {
          rules: [{ field: 'rfm', operator: 'rfm_score', value: { minFrequency: 1 } }],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);

        const liveCount = await SegmentService.refreshMembershipCache(
          db,
          BEHAVIORAL_TENANT,
          segmentId,
          where
        );
        const cached = await SegmentService.getCachedMembership(db, BEHAVIORAL_TENANT, segmentId);
        const { rows: liveRows } = await SegmentService.listMatching(db, where, 0, 50);

        expect(liveCount).toBe(liveRows.length);
        expect(cached.sort()).toEqual(liveRows.map((r) => r.id).sort());
        expect(cached).toEqual([recentBuyerId]);
      });

      it('a second refresh replaces (not appends to) the previous cache snapshot', async () => {
        const segmentId = 88_000_501 + Math.floor(Math.random() * 1000);
        const def: SegmentFilterDefinition = {
          rules: [{ field: 'rfm', operator: 'rfm_score', value: { minFrequency: 1 } }],
          logic: 'AND',
        };
        const where = SegmentService.customWhere(BEHAVIORAL_TENANT, def);

        await SegmentService.refreshMembershipCache(db, BEHAVIORAL_TENANT, segmentId, where);
        await SegmentService.refreshMembershipCache(db, BEHAVIORAL_TENANT, segmentId, where);
        const cached = await SegmentService.getCachedMembership(db, BEHAVIORAL_TENANT, segmentId);
        expect(cached).toEqual([recentBuyerId]); // not duplicated
      });
    });
  });
});
