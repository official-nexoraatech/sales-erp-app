import { and, eq, gte, lte, or } from 'drizzle-orm';
import { pricingPromotions, type PricingPromotion } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { roundToDecimal } from '@erp/utils';

// Multi-vertical platform audit 2026-08-16, Phase 2: no multi-buy/bundle/tiered-pricing engine
// existed anywhere in sales-service — only a flat per-line/per-order percentage discount
// (discount-policy.ts). This is a genuinely new capability driven by the Grocery expansion, not
// a generalization of existing cloth-retail code.
export interface CartLine {
  itemId: number;
  categoryId?: number | undefined;
  quantity: number;
  unitPrice: number;
}

export interface PromotionApplication {
  itemId: number;
  promotionId: number;
  promotionName: string;
  promotionType: PricingPromotion['promotionType'];
  // How many units of the line qualify for the promotion's discount (not necessarily the
  // line's full quantity — e.g. "buy 2 get 1 free" on a line of 7 units frees 2, not 3).
  discountedUnits: number;
  // Total rupee discount this promotion contributes to this line — the caller applies this as
  // an ordinary discountAmount on the line, reusing GSTCalculator's existing discount handling
  // rather than this engine computing tax itself.
  discountAmount: number;
}

export class PromotionEngine {
  // Active promotions for a tenant as of `asOf` (defaults to now), scoped to the given items/
  // categories present in the cart — callers pass only the ids they actually need evaluated.
  static async loadActivePromotions(
    db: ErpDatabase,
    tenantId: number,
    itemIds: number[],
    categoryIds: number[],
    asOf: Date = new Date()
  ): Promise<PricingPromotion[]> {
    if (itemIds.length === 0 && categoryIds.length === 0) return [];

    const scopeConditions = [];
    if (itemIds.length > 0) {
      scopeConditions.push(...itemIds.map((id) => eq(pricingPromotions.itemId, id)));
    }
    if (categoryIds.length > 0) {
      scopeConditions.push(...categoryIds.map((id) => eq(pricingPromotions.categoryId, id)));
    }

    return db
      .select()
      .from(pricingPromotions)
      .where(
        and(
          eq(pricingPromotions.tenantId, tenantId),
          eq(pricingPromotions.isActive, true),
          lte(pricingPromotions.startDate, asOf),
          gte(pricingPromotions.endDate, asOf),
          or(...scopeConditions)
        )
      );
  }

  // Pure function — no DB access — so it's independently testable and reusable from both the
  // POS-facing evaluate endpoint and (later) quotation/invoice creation.
  static evaluate(lines: CartLine[], promotions: PricingPromotion[]): PromotionApplication[] {
    const results: PromotionApplication[] = [];

    for (const line of lines) {
      if (line.quantity <= 0 || line.unitPrice <= 0) continue;

      // itemId-scoped promotions take precedence over categoryId-scoped ones for the same
      // line — an item-specific deal is a more deliberate merchandising decision than a
      // blanket category one.
      const itemMatches = promotions.filter((p) => p.itemId === line.itemId);
      const categoryMatches =
        line.categoryId !== undefined
          ? promotions.filter((p) => p.itemId === null && p.categoryId === line.categoryId)
          : [];
      const candidates = itemMatches.length > 0 ? itemMatches : categoryMatches;
      if (candidates.length === 0) continue;

      let best: PromotionApplication | undefined;
      for (const promo of candidates) {
        const bundleSize = promo.buyQuantity + promo.getQuantity;
        if (bundleSize <= 0 || promo.getQuantity <= 0) continue;

        const bundlesCompleted = Math.floor(line.quantity / bundleSize);
        const discountedUnits = bundlesCompleted * promo.getQuantity;
        if (discountedUnits <= 0) continue;

        const discountPct =
          promo.promotionType === 'BUY_X_GET_Y_FREE' ? 100 : parseFloat(promo.getDiscountPct);
        const discountAmount = roundToDecimal(
          discountedUnits * line.unitPrice * (discountPct / 100),
          2
        );
        if (discountAmount <= 0) continue;

        // Multiple candidate promotions on the same line (e.g. two different item-scoped
        // deals somehow both configured) — pick whichever gives the customer the larger
        // discount rather than stacking them, avoiding an ambiguous "which one applied" state.
        if (!best || discountAmount > best.discountAmount) {
          best = {
            itemId: line.itemId,
            promotionId: promo.id,
            promotionName: promo.name,
            promotionType: promo.promotionType,
            discountedUnits,
            discountAmount,
          };
        }
      }

      if (best) results.push(best);
    }

    return results;
  }

  static async evaluateCart(
    db: ErpDatabase,
    tenantId: number,
    lines: CartLine[],
    asOf?: Date
  ): Promise<PromotionApplication[]> {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const categoryIds = [
      ...new Set(lines.map((l) => l.categoryId).filter((id): id is number => id !== undefined)),
    ];
    const promotions = await PromotionEngine.loadActivePromotions(
      db,
      tenantId,
      itemIds,
      categoryIds,
      asOf
    );
    return PromotionEngine.evaluate(lines, promotions);
  }
}
