import { and, eq, lt, inArray, sql } from 'drizzle-orm';
import { loyaltyTransactions, customers, featureFlags } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

const DEFAULT_EARN_RATE = 100; // ₹100 = 1 point
const DEFAULT_REDEEM_RATE = 0.5; // 1 point = ₹0.50

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

    const [customer] = await this.db
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new NotFoundError('Customer not found');

    const balanceBefore = customer.loyaltyPoints ?? 0;
    const balanceAfter = balanceBefore + points;

    await this.db.transaction(async (trx) => {
      await trx.insert(loyaltyTransactions).values({
        tenantId,
        customerId,
        type: 'EARN',
        points,
        balanceBefore,
        balanceAfter,
        referenceType,
        referenceId,
        createdBy,
      });
      await trx
        .update(customers)
        .set({ loyaltyPoints: balanceAfter })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    });

    return points;
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

    const [customer] = await this.db
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new NotFoundError('Customer not found');

    const balance = customer.loyaltyPoints ?? 0;
    if (points > balance)
      throw new BusinessError('INSUFFICIENT_POINTS', `Only ${balance} points available`, {
        available: balance,
        requested: points,
      });

    const redemptionValue = round2(points * DEFAULT_REDEEM_RATE);
    const balanceAfter = balance - points;

    await this.db.transaction(async (trx) => {
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
    });

    return redemptionValue;
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

  async getBalance(customerId: number, tenantId: number) {
    const [customer] = await this.db
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new NotFoundError('Customer not found');

    const redeemValue = round2((customer.loyaltyPoints ?? 0) * DEFAULT_REDEEM_RATE);
    const tier =
      (customer.loyaltyPoints ?? 0) >= 5000
        ? 'GOLD'
        : (customer.loyaltyPoints ?? 0) >= 1000
          ? 'SILVER'
          : 'BRONZE';

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

    return { points: customer.loyaltyPoints ?? 0, redeemValue, tier, history };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
