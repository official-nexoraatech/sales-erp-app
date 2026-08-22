import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  loyaltyTransactions,
  customers,
  crmLoyaltyTiers,
  crmRedemptionCatalog,
  type CrmLoyaltyTier,
  type CrmRedemptionCatalogItem,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { withTenantConnection } from '@erp/sdk';
import { NotFoundError, ValidationError } from '@erp/types';

const DEFAULT_REDEEM_RATE = 0.5; // 1 point = ₹0.50
// Points expiring within this window surface in the point-expiry-warning notification job.
export const EXPIRY_WARNING_WINDOW_DAYS = 30;

// CRM/O2C split — this is half of a split class. The other half (isEnabled, evaluateTier,
// earnPoints, creditPoints, redeemPoints, redeemCatalogItem) stays at
// apps/sales-service/src/domain/LoyaltyService.ts because pos.routes.ts calls those methods
// via new LoyaltyService(trxDb) — instantiated with the POS sale's own transaction-scoped DB
// client, so loyalty award/redemption commits atomically with the sale. This half is purely
// administrative/read: no POS-transaction involvement.
export class LoyaltyService {
  constructor(private db: ErpDatabase) {}

  // RLS-readiness follow-up (2026-08-22): the initial SELECT is a genuine cross-tenant sweep by
  // design (finds every tenant's expired EARN points in one pass) — same accepted-gap category
  // as other cross-tenant batch reads elsewhere in this rollout, left unscoped since it's
  // read-only. Each row DOES carry its own tenantId though, so the per-row write (the
  // security/correctness-sensitive part) now gets its own withTenantConnection wrap per row,
  // replacing the old db.transaction() call — that ran on the plain pooled db and never set the
  // GUC (TenantScopedDatabase.transaction() would have; a plain ErpDatabase's .transaction()
  // does not).
  async expirePoints(db: ErpDatabase): Promise<number> {
    const expiredRows = await db
      .select({
        id: loyaltyTransactions.id,
        customerId: loyaltyTransactions.customerId,
        tenantId: loyaltyTransactions.tenantId,
        points: loyaltyTransactions.points,
      })
      .from(loyaltyTransactions)
      .where(
        and(
          inArray(loyaltyTransactions.type, ['EARN']),
          lt(loyaltyTransactions.expiryDate, new Date()),
          sql`NOT EXISTS (
          SELECT 1 FROM loyalty_transactions lt2
          WHERE lt2.reference_id = ${loyaltyTransactions.id}
          AND lt2.reference_type = 'EXPIRY'
          AND lt2.type = 'EXPIRE'
        )`
        )
      );

    for (const row of expiredRows) {
      await withTenantConnection(db, row.tenantId, async (scopedDb) => {
        const [customer] = await scopedDb
          .select({ loyaltyPoints: customers.loyaltyPoints })
          .from(customers)
          .where(and(eq(customers.id, row.customerId), eq(customers.tenantId, row.tenantId)));
        if (!customer) return;

        const bal = customer.loyaltyPoints ?? 0;
        const deduct = Math.min(bal, row.points);
        if (deduct <= 0) return;

        await scopedDb.insert(loyaltyTransactions).values({
          tenantId: row.tenantId,
          customerId: row.customerId,
          type: 'EXPIRE',
          points: -deduct,
          balanceBefore: bal,
          balanceAfter: bal - deduct,
          referenceType: 'EXPIRY',
          referenceId: row.id,
          createdBy: 0,
        });
        await scopedDb
          .update(customers)
          .set({ loyaltyPoints: bal - deduct })
          .where(and(eq(customers.id, row.customerId), eq(customers.tenantId, row.tenantId)));
      });
    }

    return expiredRows.length;
  }

  /** Customers with EARN points expiring within `withinDays`, for the expiry-warning job. */
  async getExpiringPoints(
    tenantId: number,
    withinDays: number
  ): Promise<Array<{ customerId: number; expiringPoints: number; expiryDate: Date }>> {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        customerId: loyaltyTransactions.customerId,
        expiringPoints: sql<number>`SUM(${loyaltyTransactions.points})::int`,
        earliestExpiry: sql<string>`MIN(${loyaltyTransactions.expiryDate})`,
      })
      .from(loyaltyTransactions)
      .where(
        and(
          eq(loyaltyTransactions.tenantId, tenantId),
          eq(loyaltyTransactions.type, 'EARN'),
          // .toISOString(): a raw JS Date interpolated directly into this sql`` template
          // crashes postgres.js's parameter binder (ERR_INVALID_ARG_TYPE) — this is the raw-sql
          // tag, not drizzle's typed lt()/gte() operators, which apply the column's driver-value
          // mapper first and don't need this (see SegmentService.prebuiltWhere for the same bug
          // class fixed there previously).
          sql`${loyaltyTransactions.expiryDate} IS NOT NULL
              AND ${loyaltyTransactions.expiryDate} <= ${cutoff.toISOString()}
              AND ${loyaltyTransactions.expiryDate} > now()`,
          sql`NOT EXISTS (
            SELECT 1 FROM loyalty_transactions lt2
            WHERE lt2.reference_id = ${loyaltyTransactions.id}
            AND lt2.reference_type = 'EXPIRY'
            AND lt2.type = 'EXPIRE'
          )`
        )
      )
      .groupBy(loyaltyTransactions.customerId);

    return rows
      .filter((r) => (r.expiringPoints ?? 0) > 0)
      .map((r) => ({
        customerId: r.customerId,
        expiringPoints: r.expiringPoints,
        expiryDate: new Date(r.earliestExpiry),
      }));
  }

  async getBalance(customerId: number, tenantId: number) {
    const [customer] = await this.db
      .select({ loyaltyPoints: customers.loyaltyPoints, loyaltyTierId: customers.loyaltyTierId })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new NotFoundError('Customer not found');

    const redeemValue = round2((customer.loyaltyPoints ?? 0) * DEFAULT_REDEEM_RATE);

    const tiers = await this.db
      .select()
      .from(crmLoyaltyTiers)
      .where(and(eq(crmLoyaltyTiers.tenantId, tenantId), eq(crmLoyaltyTiers.isActive, true)))
      .orderBy(crmLoyaltyTiers.minLifetimePoints);

    const currentTier = tiers.find((t) => t.id === customer.loyaltyTierId) ?? null;
    const nextTier =
      tiers.find((t) => t.minLifetimePoints > (currentTier?.minLifetimePoints ?? -1)) ?? null;
    const lifetimeEarned = await this.getLifetimeEarned(tenantId, customerId);

    const history = await this.db
      .select()
      .from(loyaltyTransactions)
      .where(
        and(
          eq(loyaltyTransactions.customerId, customerId),
          eq(loyaltyTransactions.tenantId, tenantId)
        )
      )
      .orderBy(sql`created_at DESC`)
      .limit(20);

    return {
      points: customer.loyaltyPoints ?? 0,
      redeemValue,
      tier: currentTier?.name ?? null,
      nextTier: nextTier
        ? {
            name: nextTier.name,
            pointsNeeded: Math.max(0, nextTier.minLifetimePoints - lifetimeEarned),
          }
        : null,
      history,
    };
  }

  private async getLifetimeEarned(tenantId: number, customerId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${loyaltyTransactions.points}), 0)::int` })
      .from(loyaltyTransactions)
      .where(
        and(
          eq(loyaltyTransactions.tenantId, tenantId),
          eq(loyaltyTransactions.customerId, customerId),
          inArray(loyaltyTransactions.type, ['EARN', 'BIRTHDAY_BONUS'])
        )
      );
    return row?.total ?? 0;
  }

  // ════════════════════════════════════════════════════════════════════
  // Tier configuration (LOYALTY_TIER_MANAGE)
  // ════════════════════════════════════════════════════════════════════

  async listTiers(tenantId: number): Promise<CrmLoyaltyTier[]> {
    return this.db
      .select()
      .from(crmLoyaltyTiers)
      .where(eq(crmLoyaltyTiers.tenantId, tenantId))
      .orderBy(crmLoyaltyTiers.minLifetimePoints);
  }

  async createTier(
    tenantId: number,
    userId: number,
    params: { name: string; code: string; minLifetimePoints: number; benefits?: string | undefined }
  ): Promise<CrmLoyaltyTier> {
    if (params.minLifetimePoints < 0)
      throw new ValidationError('minLifetimePoints cannot be negative');
    const [tier] = await this.db
      .insert(crmLoyaltyTiers)
      .values({
        tenantId,
        name: params.name,
        code: params.code,
        minLifetimePoints: params.minLifetimePoints,
        benefits: params.benefits ?? null,
        createdBy: userId,
      })
      .returning();
    if (!tier) throw new Error('Loyalty tier creation failed unexpectedly');
    return tier;
  }

  async updateTier(
    tenantId: number,
    tierId: number,
    patch: Partial<{
      name: string | undefined;
      minLifetimePoints: number | undefined;
      benefits: string | null | undefined;
      isActive: boolean | undefined;
    }>
  ): Promise<CrmLoyaltyTier> {
    const [updated] = await this.db
      .update(crmLoyaltyTiers)
      .set({ ...patch, updatedAt: new Date(), version: sql`${crmLoyaltyTiers.version} + 1` })
      .where(and(eq(crmLoyaltyTiers.id, tierId), eq(crmLoyaltyTiers.tenantId, tenantId)))
      .returning();
    if (!updated) throw new NotFoundError('Loyalty tier', tierId);
    return updated;
  }

  // ════════════════════════════════════════════════════════════════════
  // Redemption catalog (LOYALTY_TIER_MANAGE to configure, LOYALTY_REDEEM to redeem)
  // ════════════════════════════════════════════════════════════════════

  async listCatalog(tenantId: number): Promise<CrmRedemptionCatalogItem[]> {
    return this.db
      .select()
      .from(crmRedemptionCatalog)
      .where(
        and(eq(crmRedemptionCatalog.tenantId, tenantId), eq(crmRedemptionCatalog.isActive, true))
      )
      .orderBy(crmRedemptionCatalog.pointsCost);
  }

  async createCatalogItem(
    tenantId: number,
    userId: number,
    params: {
      name: string;
      description?: string | undefined;
      pointsCost: number;
      rewardType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT';
      rewardValue: number;
    }
  ): Promise<CrmRedemptionCatalogItem> {
    if (params.pointsCost <= 0) throw new ValidationError('pointsCost must be positive');
    if (
      params.rewardType === 'DISCOUNT_PERCENT' &&
      (params.rewardValue <= 0 || params.rewardValue > 100)
    ) {
      throw new ValidationError('DISCOUNT_PERCENT rewardValue must be between 0 and 100');
    }
    if (params.rewardValue <= 0) throw new ValidationError('rewardValue must be positive');

    const [item] = await this.db
      .insert(crmRedemptionCatalog)
      .values({
        tenantId,
        name: params.name,
        description: params.description ?? null,
        pointsCost: params.pointsCost,
        rewardType: params.rewardType,
        rewardValue: String(params.rewardValue),
        createdBy: userId,
      })
      .returning();
    if (!item) throw new Error('Redemption catalog item creation failed unexpectedly');
    return item;
  }

  async updateCatalogItem(
    tenantId: number,
    itemId: number,
    patch: Partial<{
      name: string | undefined;
      description: string | null | undefined;
      pointsCost: number | undefined;
      isActive: boolean | undefined;
    }>
  ): Promise<CrmRedemptionCatalogItem> {
    const [updated] = await this.db
      .update(crmRedemptionCatalog)
      .set({ ...patch, updatedAt: new Date(), version: sql`${crmRedemptionCatalog.version} + 1` })
      .where(and(eq(crmRedemptionCatalog.id, itemId), eq(crmRedemptionCatalog.tenantId, tenantId)))
      .returning();
    if (!updated) throw new NotFoundError('Redemption catalog item', itemId);
    return updated;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
