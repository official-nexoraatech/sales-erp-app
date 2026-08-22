import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  loyaltyTransactions,
  customers,
  featureFlags,
  crmLoyaltyTiers,
  crmRedemptionCatalog,
  crmLoyaltyRedemptions,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
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

// CRM/O2C split — this is half of a split class. getLifetimeEarned, getBalance, listTiers/
// createTier/updateTier, listCatalog/createCatalogItem/updateCatalogItem, getExpiringPoints,
// expirePoints, and EXPIRY_WARNING_WINDOW_DAYS moved to
// apps/crm-service/src/domain/LoyaltyService.ts — none of them are called from within a POS
// sale's transaction. What stays here (isEnabled, evaluateTier, earnPoints, creditPoints,
// redeemPoints, redeemCatalogItem) IS called that way — pos.routes.ts instantiates
// new LoyaltyService(trxDb) with the sale's own transaction-scoped DB client, so award/
// redemption commits atomically with the sale (this.db.transaction(...) nests as a savepoint).
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
