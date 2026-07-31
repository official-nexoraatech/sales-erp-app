import { and, desc, eq, lt, inArray, sql } from 'drizzle-orm';
import {
  loyaltyTransactions,
  customers,
  featureFlags,
  crmLoyaltyTiers,
  crmRedemptionCatalog,
  crmLoyaltyRedemptions,
  outboxEvents,
  type CrmLoyaltyTier,
  type CrmRedemptionCatalogItem,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { ulid } from 'ulid';

const DEFAULT_EARN_RATE = 100; // ₹100 = 1 point
const DEFAULT_REDEEM_RATE = 0.5; // 1 point = ₹0.50
// CRM-ROADMAP Phase 2, Feature 3: points earned expire after this many days if unused. This
// codebase already had a fully-built expiry PIPELINE (loyalty_transactions.expiry_date column,
// the WHERE clause below, a registered daily scheduler job calling expirePoints()) that had
// never actually expired a single point in production — confirmed via grep: expiryDate was
// referenced in exactly one place (this file's own query) and written nowhere. earnPoints() now
// sets it; the rest of the pipeline was already correct and needed no change.
const DEFAULT_POINTS_EXPIRY_DAYS = 365;
// Points expiring within this window surface in the point-expiry-warning notification job.
export const EXPIRY_WARNING_WINDOW_DAYS = 30;

export class LoyaltyService {
  constructor(private db: ErpDatabase) {}

  private async isEnabled(tenantId: number): Promise<boolean> {
    const [flag] = await this.db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(
        and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.flagKey, 'sales.loyalty.enabled'))
      );
    return flag?.enabled ?? false;
  }

  async earnPoints(
    tenantId: number,
    customerId: number,
    grandTotal: number,
    referenceType: string,
    referenceId: number,
    createdBy: number
  ): Promise<number> {
    if (!(await this.isEnabled(tenantId))) return 0;

    const points = Math.floor(grandTotal / DEFAULT_EARN_RATE);
    if (points === 0) return 0;

    await this.db.transaction(async (trx) => {
      // SELECT ... FOR UPDATE: without this, two concurrent earn/redeem calls for the same
      // customer read the same stale balance and the second write clobbers the first's update —
      // same class of bug as ValuationService's stock-deduction race (see that file's own
      // comment). The lock is held until this transaction commits, so it also protects the
      // balance UPDATE below and (transitively) evaluateTier's read of the just-updated total.
      const [customer] = await trx
        .select({ loyaltyPoints: customers.loyaltyPoints, loyaltyTierId: customers.loyaltyTierId })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
        .for('update');
      if (!customer) throw new NotFoundError('Customer', customerId);

      const balanceBefore = customer.loyaltyPoints ?? 0;
      const balanceAfter = balanceBefore + points;
      const expiryDate = new Date(Date.now() + DEFAULT_POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      await trx.insert(loyaltyTransactions).values({
        tenantId,
        customerId,
        type: 'EARN',
        points,
        balanceBefore,
        balanceAfter,
        referenceType,
        referenceId,
        expiryDate,
        createdBy,
      });
      await trx
        .update(customers)
        .set({ loyaltyPoints: balanceAfter })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

      await this.evaluateTier(trx, tenantId, customerId, customer.loyaltyTierId);
    });

    return points;
  }

  /**
   * Credits a flat point amount not tied to a purchase — e.g. CRM-ROADMAP Phase 2, Feature 4's
   * referral rewards. Reuses the exact same FOR UPDATE + tier-evaluation discipline as
   * earnPoints() above; only the earn-rate math differs (a flat amount here vs. a percentage of
   * grandTotal there). Returns the created ledger transaction's id (callers like ReferralService
   * need it to link a reward row back to its ledger entry) rather than earnPoints()'s plain
   * points-only return, since this is a new method with no existing callers to stay compatible
   * with.
   */
  async creditPoints(
    tenantId: number,
    customerId: number,
    points: number,
    referenceType: string,
    referenceId: number,
    createdBy: number,
    notes?: string
  ): Promise<{ points: number; transactionId: number }> {
    if (points <= 0) return { points: 0, transactionId: 0 };
    if (!(await this.isEnabled(tenantId))) return { points: 0, transactionId: 0 };

    return this.db.transaction(async (trx) => {
      const [customer] = await trx
        .select({ loyaltyPoints: customers.loyaltyPoints, loyaltyTierId: customers.loyaltyTierId })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
        .for('update');
      if (!customer) throw new NotFoundError('Customer', customerId);

      const balanceBefore = customer.loyaltyPoints ?? 0;
      const balanceAfter = balanceBefore + points;
      const expiryDate = new Date(Date.now() + DEFAULT_POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      const [txn] = await trx
        .insert(loyaltyTransactions)
        .values({
          tenantId,
          customerId,
          type: 'EARN',
          points,
          balanceBefore,
          balanceAfter,
          referenceType,
          referenceId,
          expiryDate,
          notes,
          createdBy,
        })
        .returning();
      if (!txn) throw new Error('Loyalty transaction creation failed unexpectedly');

      await trx
        .update(customers)
        .set({ loyaltyPoints: balanceAfter })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

      await this.evaluateTier(trx, tenantId, customerId, customer.loyaltyTierId);

      return { points, transactionId: txn.id };
    });
  }

  async redeemPoints(
    tenantId: number,
    customerId: number,
    points: number,
    referenceType: string,
    referenceId: number,
    createdBy: number
  ): Promise<number> {
    if (!(await this.isEnabled(tenantId))) return 0;

    return this.db.transaction(async (trx) => {
      // SELECT ... FOR UPDATE — see earnPoints' own comment. This is the debit path, so the
      // "must never allow negative point balance under concurrent load" requirement lives here.
      const [customer] = await trx
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
        .for('update');
      if (!customer) throw new NotFoundError('Customer', customerId);

      const balance = customer.loyaltyPoints ?? 0;
      if (points > balance) {
        throw new BusinessError('INSUFFICIENT_POINTS', `Only ${balance} points available`, {
          available: balance,
          requested: points,
        });
      }

      const redemptionValue = round2(points * DEFAULT_REDEEM_RATE);
      const balanceAfter = balance - points;

      await trx.insert(loyaltyTransactions).values({
        tenantId,
        customerId,
        type: 'REDEEM',
        points: -points,
        balanceBefore: balance,
        balanceAfter,
        referenceType,
        referenceId,
        createdBy,
      });
      await trx
        .update(customers)
        .set({ loyaltyPoints: balanceAfter })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

      return redemptionValue;
    });
  }

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
      const [customer] = await db
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, row.customerId), eq(customers.tenantId, row.tenantId)));
      if (!customer) continue;

      const bal = customer.loyaltyPoints ?? 0;
      const deduct = Math.min(bal, row.points);
      if (deduct <= 0) continue;

      await db.transaction(async (trx) => {
        await trx.insert(loyaltyTransactions).values({
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
        await trx
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

  /**
   * Tiers are derived from LIFETIME points earned (never reduced by redemption/expiry), so a
   * customer's tier can only go up, never down automatically — see crm_loyalty_tiers' own doc
   * comment for why this sidesteps the roadmap's flagged "customer-experience-sensitive"
   * auto-downgrade question. Called on-transaction (inside earnPoints), not just nightly, so
   * Customer 360's tier badge updates immediately when a threshold is crossed.
   */
  private async evaluateTier(
    trx: ErpDatabase,
    tenantId: number,
    customerId: number,
    currentTierId: number | null
  ): Promise<void> {
    const [lifetime] = await trx
      .select({ total: sql<number>`COALESCE(SUM(${loyaltyTransactions.points}), 0)::int` })
      .from(loyaltyTransactions)
      .where(
        and(
          eq(loyaltyTransactions.tenantId, tenantId),
          eq(loyaltyTransactions.customerId, customerId),
          inArray(loyaltyTransactions.type, ['EARN', 'BIRTHDAY_BONUS'])
        )
      );
    const lifetimeEarned = lifetime?.total ?? 0;

    const tiers = await trx
      .select()
      .from(crmLoyaltyTiers)
      .where(and(eq(crmLoyaltyTiers.tenantId, tenantId), eq(crmLoyaltyTiers.isActive, true)))
      .orderBy(desc(crmLoyaltyTiers.minLifetimePoints));

    const eligible = tiers.find((t) => lifetimeEarned >= t.minLifetimePoints);
    if (!eligible || eligible.id === currentTierId) return;

    if (currentTierId) {
      const current = tiers.find((t) => t.id === currentTierId);
      // A tenant may have lowered a higher tier's threshold after a customer was already
      // assigned a lower one — never demote even if the "eligible" tier resolves lower.
      if (current && current.minLifetimePoints >= eligible.minLifetimePoints) return;
    }

    await trx
      .update(customers)
      .set({ loyaltyTierId: eligible.id })
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

    await trx.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'LOYALTY_TIER_CHANGED',
      aggregateType: 'Customer',
      aggregateId: customerId,
      tenantId,
      payload: {
        customerId,
        fromTierId: currentTierId,
        toTierId: eligible.id,
        tierName: eligible.name,
      },
      published: false,
    });
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

  /**
   * Redeems a specific catalog reward — still posts through the exact same loyaltyTransactions
   * ledger as the generic points->currency redeemPoints() above (never a parallel rewards rail),
   * plus a crm_loyalty_redemptions row recording which reward was chosen.
   */
  async redeemCatalogItem(
    tenantId: number,
    customerId: number,
    catalogItemId: number,
    referenceType: string,
    referenceId: number,
    createdBy: number
  ): Promise<{
    rewardType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT';
    rewardValue: number;
    redemptionId: number;
  }> {
    const [item] = await this.db
      .select()
      .from(crmRedemptionCatalog)
      .where(
        and(
          eq(crmRedemptionCatalog.id, catalogItemId),
          eq(crmRedemptionCatalog.tenantId, tenantId),
          eq(crmRedemptionCatalog.isActive, true)
        )
      );
    if (!item) throw new NotFoundError('Redemption catalog item', catalogItemId);

    return this.db.transaction(async (trx) => {
      const [customer] = await trx
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
        .for('update');
      if (!customer) throw new NotFoundError('Customer', customerId);

      const balance = customer.loyaltyPoints ?? 0;
      if (item.pointsCost > balance) {
        throw new BusinessError('INSUFFICIENT_POINTS', `Only ${balance} points available`, {
          available: balance,
          requested: item.pointsCost,
        });
      }
      const balanceAfter = balance - item.pointsCost;

      const [txnRow] = await trx
        .insert(loyaltyTransactions)
        .values({
          tenantId,
          customerId,
          type: 'REDEEM',
          points: -item.pointsCost,
          balanceBefore: balance,
          balanceAfter,
          referenceType,
          referenceId,
          notes: `Redeemed: ${item.name}`,
          createdBy,
        })
        .returning();
      if (!txnRow) throw new Error('Loyalty transaction creation failed unexpectedly');

      await trx
        .update(customers)
        .set({ loyaltyPoints: balanceAfter })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

      const [redemption] = await trx
        .insert(crmLoyaltyRedemptions)
        .values({
          tenantId,
          customerId,
          catalogItemId: item.id,
          pointsCost: item.pointsCost,
          rewardType: item.rewardType,
          rewardValue: item.rewardValue,
          loyaltyTransactionId: txnRow.id,
          invoiceId: referenceType === 'INVOICE' ? referenceId : null,
          createdBy,
        })
        .returning();
      if (!redemption) throw new Error('Redemption record creation failed unexpectedly');

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'LOYALTY_REDEEMED',
        aggregateType: 'Customer',
        aggregateId: customerId,
        tenantId,
        payload: {
          customerId,
          catalogItemId: item.id,
          pointsCost: item.pointsCost,
          rewardType: item.rewardType,
          rewardValue: item.rewardValue,
        },
        published: false,
      });

      return {
        rewardType: item.rewardType,
        rewardValue: parseFloat(String(item.rewardValue)),
        redemptionId: redemption.id,
      };
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
