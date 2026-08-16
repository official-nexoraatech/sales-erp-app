/**
 * Multi-vertical platform audit 2026-08-16, Phase 2 — multi-buy/BOGO pricing promotions.
 * PromotionEngine.evaluate()'s pure logic is covered by promotion-engine.test.ts; this suite
 * proves the DB-touching halves — PromotionService's CRUD (validation, optimistic locking) and
 * PromotionEngine.evaluateCart()'s active/date-range/tenant-scoped query — against a real
 * database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { pricingPromotions } from '@erp/db';
import { eq } from 'drizzle-orm';
import { OptimisticLockError, ValidationError } from '@erp/types';
import { PromotionService } from '../domain/PromotionService.js';
import { PromotionEngine } from '../domain/PromotionEngine.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('PromotionService + PromotionEngine.evaluateCart — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 908_001 + Math.floor(Math.random() * 1000);
  const ITEM_ID = 501;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    await db.delete(pricingPromotions).where(eq(pricingPromotions.tenantId, TEST_TENANT));
  });

  it('rejects a promotion with both itemId and categoryId, or neither', async () => {
    await expect(
      PromotionService.create(db, TEST_TENANT, 1, {
        name: 'Bad',
        promotionType: 'BUY_X_GET_Y_FREE',
        buyQuantity: 2,
        getQuantity: 1,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      PromotionService.create(db, TEST_TENANT, 1, {
        name: 'Bad',
        promotionType: 'BUY_X_GET_Y_FREE',
        itemId: ITEM_ID,
        categoryId: 7,
        buyQuantity: 2,
        getQuantity: 1,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      })
    ).rejects.toThrow(ValidationError);
  });

  it('creates, lists, and updates a promotion with optimistic locking', async () => {
    const created = await PromotionService.create(db, TEST_TENANT, 1, {
      name: 'Buy 2 Get 1 Free — Test Item',
      promotionType: 'BUY_X_GET_Y_FREE',
      itemId: ITEM_ID,
      buyQuantity: 2,
      getQuantity: 1,
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // started yesterday
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // ends in 30 days
    });
    expect(created.itemId).toBe(ITEM_ID);
    expect(created.version).toBe(0);

    const list = await PromotionService.list(db, TEST_TENANT);
    expect(list.some((p) => p.id === created.id)).toBe(true);

    const updated = await PromotionService.update(db, TEST_TENANT, created.id, {
      version: 0,
      name: 'Buy 2 Get 1 Free — Renamed',
    });
    expect(updated.name).toBe('Buy 2 Get 1 Free — Renamed');
    expect(updated.version).toBe(1);

    // Stale version rejected
    await expect(
      PromotionService.update(db, TEST_TENANT, created.id, { version: 0, isActive: false })
    ).rejects.toThrow(OptimisticLockError);
  });

  it('evaluateCart() only picks up active, in-date-range, tenant-scoped promotions', async () => {
    const now = new Date();
    const active = await PromotionService.create(db, TEST_TENANT, 1, {
      name: 'Active Promo',
      promotionType: 'BUY_X_GET_Y_FREE',
      itemId: ITEM_ID + 1,
      buyQuantity: 1,
      getQuantity: 1,
      startDate: new Date(now.getTime() - 86_400_000),
      endDate: new Date(now.getTime() + 86_400_000),
    });
    // Expired — should not apply
    await PromotionService.create(db, TEST_TENANT, 1, {
      name: 'Expired Promo',
      promotionType: 'BUY_X_GET_Y_FREE',
      itemId: ITEM_ID + 1,
      buyQuantity: 1,
      getQuantity: 100, // deliberately huge so a wrong match would be obvious
      startDate: new Date(now.getTime() - 2 * 86_400_000),
      endDate: new Date(now.getTime() - 86_400_000),
    });
    // Not yet started — should not apply
    await PromotionService.create(db, TEST_TENANT, 1, {
      name: 'Future Promo',
      promotionType: 'BUY_X_GET_Y_FREE',
      itemId: ITEM_ID + 1,
      buyQuantity: 1,
      getQuantity: 100,
      startDate: new Date(now.getTime() + 86_400_000),
      endDate: new Date(now.getTime() + 2 * 86_400_000),
    });

    const applications = await PromotionEngine.evaluateCart(db, TEST_TENANT, [
      { itemId: ITEM_ID + 1, quantity: 4, unitPrice: 25 },
    ]);
    expect(applications).toHaveLength(1);
    expect(applications[0]!.promotionId).toBe(active.id);
    expect(applications[0]!.discountedUnits).toBe(2); // buy 1 get 1, qty 4 -> 2 free
  });
});
