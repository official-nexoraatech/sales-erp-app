import { describe, it, expect } from 'vitest';
import { PromotionEngine, type CartLine } from '../domain/PromotionEngine.js';
import type { PricingPromotion } from '@erp/db';

function makePromotion(overrides: Partial<PricingPromotion> = {}): PricingPromotion {
  return {
    id: 1,
    tenantId: 1,
    name: 'Test Promo',
    promotionType: 'BUY_X_GET_Y_FREE',
    itemId: 100,
    categoryId: null,
    buyQuantity: 2,
    getQuantity: 1,
    getDiscountPct: '100',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    isActive: true,
    createdBy: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 0,
    ...overrides,
  } as PricingPromotion;
}

describe('PromotionEngine.evaluate', () => {
  it('BUY_X_GET_Y_FREE: buy 2 get 1 free — a cart of 3 frees exactly 1 unit', () => {
    const lines: CartLine[] = [{ itemId: 100, quantity: 3, unitPrice: 50 }];
    const promotions = [makePromotion()];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(1);
    expect(result[0]!.discountedUnits).toBe(1);
    expect(result[0]!.discountAmount).toBe(50);
  });

  it('completes multiple bundles: buy 2 get 1 free on a cart of 7 frees 2 units (2 complete bundles of 3)', () => {
    const lines: CartLine[] = [{ itemId: 100, quantity: 7, unitPrice: 20 }];
    const promotions = [makePromotion()];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(1);
    expect(result[0]!.discountedUnits).toBe(2); // 7 / 3 = 2 complete bundles, 1 leftover unit
    expect(result[0]!.discountAmount).toBe(40);
  });

  it('below one full bundle: a cart of 2 (buy 2 get 1 needs 3) gets no discount', () => {
    const lines: CartLine[] = [{ itemId: 100, quantity: 2, unitPrice: 50 }];
    const promotions = [makePromotion()];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(0);
  });

  it('BUY_X_GET_Y_PERCENT_OFF: buy 1 get 1 at 50% off', () => {
    const lines: CartLine[] = [{ itemId: 100, quantity: 2, unitPrice: 100 }];
    const promotions = [
      makePromotion({
        promotionType: 'BUY_X_GET_Y_PERCENT_OFF',
        buyQuantity: 1,
        getQuantity: 1,
        getDiscountPct: '50',
      }),
    ];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(1);
    expect(result[0]!.discountedUnits).toBe(1);
    expect(result[0]!.discountAmount).toBe(50); // 1 unit * 100 * 50%
  });

  it('no matching promotion for the line — returns nothing', () => {
    const lines: CartLine[] = [{ itemId: 999, quantity: 10, unitPrice: 50 }];
    const promotions = [makePromotion()];
    expect(PromotionEngine.evaluate(lines, promotions)).toHaveLength(0);
  });

  it('category-scoped promotion applies when the line matches by category, not item', () => {
    const lines: CartLine[] = [{ itemId: 555, categoryId: 7, quantity: 4, unitPrice: 30 }];
    const promotions = [
      makePromotion({ itemId: null, categoryId: 7, buyQuantity: 1, getQuantity: 1 }),
    ];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(1);
    expect(result[0]!.discountedUnits).toBe(2); // 4 / 2 bundles
  });

  it('item-scoped promotion takes precedence over a category-scoped one on the same line', () => {
    const lines: CartLine[] = [{ itemId: 100, categoryId: 7, quantity: 3, unitPrice: 50 }];
    const promotions = [
      makePromotion({ id: 1, itemId: 100, categoryId: null, buyQuantity: 2, getQuantity: 1 }),
      makePromotion({ id: 2, itemId: null, categoryId: 7, buyQuantity: 1, getQuantity: 1 }),
    ];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(1);
    expect(result[0]!.promotionId).toBe(1); // the item-scoped one, not the category-scoped one
  });

  it('picks the larger discount when multiple item-scoped promotions match the same line', () => {
    const lines: CartLine[] = [{ itemId: 100, quantity: 4, unitPrice: 50 }];
    const promotions = [
      makePromotion({ id: 1, buyQuantity: 2, getQuantity: 1 }), // 4/3 = 1 bundle -> 1 free unit = 50
      makePromotion({ id: 2, buyQuantity: 1, getQuantity: 1 }), // 4/2 = 2 bundles -> 2 free units = 100
    ];
    const result = PromotionEngine.evaluate(lines, promotions);
    expect(result).toHaveLength(1);
    expect(result[0]!.promotionId).toBe(2);
    expect(result[0]!.discountAmount).toBe(100);
  });

  it('ignores an inactive/zero-quantity line and a promotion with an invalid bundle shape', () => {
    expect(
      PromotionEngine.evaluate([{ itemId: 100, quantity: 0, unitPrice: 50 }], [makePromotion()])
    ).toHaveLength(0);
    expect(
      PromotionEngine.evaluate(
        [{ itemId: 100, quantity: 10, unitPrice: 50 }],
        [makePromotion({ getQuantity: 0 })]
      )
    ).toHaveLength(0);
  });
});
