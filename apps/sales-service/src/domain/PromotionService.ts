import { and, desc, eq, sql } from 'drizzle-orm';
import { pricingPromotions, type PricingPromotion } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';

export interface CreatePromotionParams {
  name: string;
  promotionType: PricingPromotion['promotionType'];
  itemId?: number | undefined;
  categoryId?: number | undefined;
  buyQuantity: number;
  getQuantity: number;
  getDiscountPct?: number | undefined;
  startDate: Date;
  endDate: Date;
}

export interface UpdatePromotionParams {
  version: number;
  name?: string | undefined;
  buyQuantity?: number | undefined;
  getQuantity?: number | undefined;
  getDiscountPct?: number | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  isActive?: boolean | undefined;
}

// Multi-vertical platform audit 2026-08-16, Phase 2 — multi-buy/BOGO pricing promotions.
// Management (this file) is deliberately separate from evaluation (PromotionEngine.ts) — the
// same "config vs. execution" split this codebase already uses elsewhere (e.g. RuleEngine vs.
// business_rules CRUD), so the checkout-time evaluation path stays a pure function with no
// validation/audit concerns mixed in.
export class PromotionService {
  static async list(db: ErpDatabase, tenantId: number): Promise<PricingPromotion[]> {
    return db
      .select()
      .from(pricingPromotions)
      .where(eq(pricingPromotions.tenantId, tenantId))
      .orderBy(desc(pricingPromotions.createdAt));
  }

  static async create(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: CreatePromotionParams
  ): Promise<PricingPromotion> {
    if (!params.itemId && !params.categoryId) {
      throw new ValidationError('Either itemId or categoryId must be set');
    }
    if (params.itemId && params.categoryId) {
      throw new ValidationError('Only one of itemId or categoryId may be set, not both');
    }
    if (params.buyQuantity <= 0 || params.getQuantity <= 0) {
      throw new ValidationError('buyQuantity and getQuantity must both be positive');
    }
    if (params.endDate <= params.startDate) {
      throw new ValidationError('endDate must be after startDate');
    }
    const getDiscountPct = params.getDiscountPct ?? 100;
    if (getDiscountPct <= 0 || getDiscountPct > 100) {
      throw new ValidationError('getDiscountPct must be between 0 (exclusive) and 100');
    }

    const [created] = await db
      .insert(pricingPromotions)
      .values({
        tenantId,
        name: params.name,
        promotionType: params.promotionType,
        itemId: params.itemId ?? null,
        categoryId: params.categoryId ?? null,
        buyQuantity: params.buyQuantity,
        getQuantity: params.getQuantity,
        getDiscountPct: String(getDiscountPct),
        startDate: params.startDate,
        endDate: params.endDate,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new BusinessError('PROMOTION_CREATE_FAILED', 'Promotion creation failed');
    return created;
  }

  static async update(
    db: ErpDatabase,
    tenantId: number,
    promotionId: number,
    patch: UpdatePromotionParams
  ): Promise<PricingPromotion> {
    if (patch.startDate && patch.endDate && patch.endDate <= patch.startDate) {
      throw new ValidationError('endDate must be after startDate');
    }
    if (
      patch.getDiscountPct !== undefined &&
      (patch.getDiscountPct <= 0 || patch.getDiscountPct > 100)
    ) {
      throw new ValidationError('getDiscountPct must be between 0 (exclusive) and 100');
    }

    const [updated] = await db
      .update(pricingPromotions)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.buyQuantity !== undefined ? { buyQuantity: patch.buyQuantity } : {}),
        ...(patch.getQuantity !== undefined ? { getQuantity: patch.getQuantity } : {}),
        ...(patch.getDiscountPct !== undefined
          ? { getDiscountPct: String(patch.getDiscountPct) }
          : {}),
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        updatedAt: new Date(),
        version: sql`${pricingPromotions.version} + 1`,
      })
      .where(
        and(
          eq(pricingPromotions.id, promotionId),
          eq(pricingPromotions.tenantId, tenantId),
          eq(pricingPromotions.version, patch.version)
        )
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ id: pricingPromotions.id })
        .from(pricingPromotions)
        .where(
          and(eq(pricingPromotions.id, promotionId), eq(pricingPromotions.tenantId, tenantId))
        );
      throw existing
        ? new OptimisticLockError('Promotion')
        : new NotFoundError('Promotion', promotionId);
    }
    return updated;
  }
}
