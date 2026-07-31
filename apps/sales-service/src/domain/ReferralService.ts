import { and, eq, gte, notInArray, or, sql } from 'drizzle-orm';
import {
  crmReferralCodes,
  crmReferralEvents,
  crmReferralRewards,
  customers,
  invoices,
  outboxEvents,
  type CrmReferralCode,
  type CrmReferralReward,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { ulid } from 'ulid';
import { LoyaltyService } from './LoyaltyService.js';

// CRM-ROADMAP Phase 2, Feature 4 (Referral Program Engine). Reward payout still posts through
// the exact same loyalty_transactions ledger as Feature 3 (via LoyaltyService.creditPoints) —
// no parallel reward rail. `crm_referral_codes.code` is globally unique (not per-tenant); every
// public route resolves the tenant FROM the code, since an unauthenticated referral link can't
// otherwise carry a tenantId.
const DEFAULT_REFERRER_REWARD_POINTS = 100;
const DEFAULT_REFEREE_REWARD_POINTS = 100;
// A phone/device/IP that's already redeemed this many other codes in the window is flagged for
// manual review instead of auto-paying — the roadmap's own security classification requires
// fraud detection to have "its own abuse-review path, not just a reward payout path."
const SUSPICIOUS_CORRELATION_THRESHOLD = 3;
const CORRELATION_WINDOW_DAYS = 30;
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids misread codes
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return code;
}

// Mirrors JourneyService.ts's isUniqueViolation — this drizzle-orm/postgres.js version wraps
// the real Postgres error (with code/constraint_name) inside a DrizzleQueryError's `.cause`
// rather than exposing those fields on the thrown error directly.
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const candidate =
    typeof err === 'object' && err !== null && 'cause' in err
      ? (err as { cause?: unknown }).cause
      : err;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as { code?: unknown }).code === '23505' &&
    (candidate as { constraint_name?: unknown }).constraint_name === constraintName
  );
}

export interface RedeemParams {
  code: string;
  refereeName?: string | undefined;
  refereePhone: string;
  ipAddress?: string | undefined;
  deviceId?: string | undefined;
}

export class ReferralService {
  static async findActiveCodeByCode(
    db: ErpDatabase,
    code: string
  ): Promise<CrmReferralCode | null> {
    const [row] = await db
      .select()
      .from(crmReferralCodes)
      .where(and(eq(crmReferralCodes.code, code), eq(crmReferralCodes.isActive, true)));
    return row ?? null;
  }

  /** Get-or-create a customer's own shareable referral code. */
  static async getOrCreateCode(
    db: ErpDatabase,
    tenantId: number,
    customerId: number
  ): Promise<CrmReferralCode> {
    const [existing] = await db
      .select()
      .from(crmReferralCodes)
      .where(
        and(eq(crmReferralCodes.tenantId, tenantId), eq(crmReferralCodes.customerId, customerId))
      );
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [created] = await db
          .insert(crmReferralCodes)
          .values({ tenantId, customerId, code: generateCode() })
          .returning();
        if (!created) throw new Error('Referral code creation failed unexpectedly');
        return created;
      } catch (err) {
        if (isUniqueViolation(err, 'crm_referral_codes_code_unique')) continue; // collision — retry with a new code
        if (isUniqueViolation(err, 'crm_referral_codes_tenant_customer_unique')) {
          // Another concurrent request just created this same customer's code — reload it.
          const [row] = await db
            .select()
            .from(crmReferralCodes)
            .where(
              and(
                eq(crmReferralCodes.tenantId, tenantId),
                eq(crmReferralCodes.customerId, customerId)
              )
            );
          if (row) return row;
        }
        throw err;
      }
    }
    throw new Error('Failed to generate a unique referral code after 5 attempts');
  }

  static async trackClick(
    db: ErpDatabase,
    code: string,
    ipAddress?: string,
    deviceId?: string
  ): Promise<CrmReferralCode | null> {
    const referralCode = await ReferralService.findActiveCodeByCode(db, code);
    if (!referralCode) return null;
    await db.insert(crmReferralEvents).values({
      tenantId: referralCode.tenantId,
      referralCodeId: referralCode.id,
      eventType: 'CLICKED',
      ipAddress,
      deviceId,
    });
    return referralCode;
  }

  /**
   * Redeems a referral code for a referee (identified by phone — the referee usually isn't a
   * customer yet). Fraud guardrails run here, before any reward row exists:
   *   1. Self-referral — the referee's phone matches the referrer's own phone.
   *   2. Already an existing customer — referrals incentivize NEW customer acquisition; someone
   *      who already has a customer record here doesn't qualify (roadmap's own explicit edge
   *      case).
   *   3. One-time-per-referee — enforced structurally by the DB's own
   *      unique(tenant_id, referee_phone) constraint, not just this check.
   *   4. Device/address correlation — too many redemptions sharing this IP/device recently
   *      flags the reward for manual review instead of auto-paying.
   * Payout itself doesn't happen here — it happens once the referee makes a qualifying purchase
   * (see attributeQualifyingPurchases), since the referee frequently isn't a real customer yet
   * at redemption time.
   */
  static async redeem(db: ErpDatabase, params: RedeemParams): Promise<CrmReferralReward> {
    const referralCode = await ReferralService.findActiveCodeByCode(db, params.code);
    if (!referralCode) throw new NotFoundError('Referral code', params.code);
    const tenantId = referralCode.tenantId;

    const [referrer] = await db
      .select({ phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.id, referralCode.customerId), eq(customers.tenantId, tenantId)));
    if (referrer && referrer.phone === params.refereePhone) {
      throw new BusinessError('SELF_REFERRAL', 'You cannot redeem your own referral code');
    }

    const [existingCustomer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, params.refereePhone)));
    if (existingCustomer) {
      throw new BusinessError(
        'ALREADY_CUSTOMER',
        'This phone number already belongs to an existing customer and is not eligible for a referral reward'
      );
    }

    const cutoff = new Date(Date.now() - CORRELATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    let flagReason: string | undefined;
    const correlationMatch = or(
      ...[
        params.ipAddress ? eq(crmReferralRewards.ipAddress, params.ipAddress) : undefined,
        params.deviceId ? eq(crmReferralRewards.deviceId, params.deviceId) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined)
    );
    if (correlationMatch) {
      const [correlated] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmReferralRewards)
        .where(
          and(
            eq(crmReferralRewards.tenantId, tenantId),
            gte(crmReferralRewards.createdAt, cutoff),
            correlationMatch
          )
        );
      if ((correlated?.count ?? 0) >= SUSPICIOUS_CORRELATION_THRESHOLD) {
        flagReason = `${correlated!.count} other referral(s) shared this IP/device within ${CORRELATION_WINDOW_DAYS} days`;
      }
    }

    try {
      const [reward] = await db
        .insert(crmReferralRewards)
        .values({
          tenantId,
          referralCodeId: referralCode.id,
          referrerCustomerId: referralCode.customerId,
          refereePhone: params.refereePhone,
          refereeName: params.refereeName,
          status: flagReason ? 'FLAGGED' : 'PENDING',
          referrerPoints: DEFAULT_REFERRER_REWARD_POINTS,
          refereePoints: DEFAULT_REFEREE_REWARD_POINTS,
          ipAddress: params.ipAddress,
          deviceId: params.deviceId,
          flagReason,
        })
        .returning();
      if (!reward) throw new Error('Referral reward creation failed unexpectedly');

      await db.insert(crmReferralEvents).values({
        tenantId,
        referralCodeId: referralCode.id,
        eventType: 'SIGNED_UP',
        ipAddress: params.ipAddress,
        deviceId: params.deviceId,
      });

      return reward;
    } catch (err) {
      if (isUniqueViolation(err, 'crm_referral_rewards_tenant_referee_phone_unique')) {
        throw new BusinessError(
          'ALREADY_REDEEMED',
          'This phone number has already redeemed a referral code and cannot redeem another'
        );
      }
      throw err;
    }
  }

  /**
   * Scheduler-driven: for every PENDING reward (never FLAGGED/REJECTED — those need
   * REFERRAL_CONFIGURE review first), checks whether the referee's phone now resolves to a real
   * customer (created after the reward, confirming this is genuinely the same signup rather than
   * a coincidental pre-existing one) who has made a qualifying purchase. If so, pays out both
   * parties atomically via LoyaltyService.creditPoints.
   *
   * Claw-back policy: once paid, a later cancellation/return of the qualifying invoice does NOT
   * claw back the reward — this deliberately matches how loyalty points earned on a sale are
   * never clawed back elsewhere in this codebase either (SaleReturnService doesn't reverse
   * loyaltyPointsEarned), so referral payouts stay consistent with that existing behavior rather
   * than inventing a stricter rule found nowhere else.
   */
  static async attributeQualifyingPurchases(db: ErpDatabase, tenantId: number): Promise<number> {
    const pending = await db
      .select()
      .from(crmReferralRewards)
      .where(
        and(eq(crmReferralRewards.tenantId, tenantId), eq(crmReferralRewards.status, 'PENDING'))
      );

    let paidCount = 0;
    const loyaltySvc = new LoyaltyService(db);

    for (const reward of pending) {
      const [refereeCustomer] = await db
        .select({ id: customers.id, createdAt: customers.createdAt })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, reward.refereePhone)));
      if (!refereeCustomer || refereeCustomer.createdAt < reward.createdAt) continue;

      const [purchase] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.customerId, refereeCustomer.id),
            notInArray(invoices.status, ['DRAFT', 'CANCELLED'])
          )
        )
        .limit(1);
      if (!purchase) continue;

      const referrerCredit = await loyaltySvc.creditPoints(
        tenantId,
        reward.referrerCustomerId,
        reward.referrerPoints,
        'REFERRAL',
        reward.id,
        0,
        `Referral reward for referring customer #${refereeCustomer.id}`
      );
      const refereeCredit = await loyaltySvc.creditPoints(
        tenantId,
        refereeCustomer.id,
        reward.refereePoints,
        'REFERRAL',
        reward.id,
        0,
        `Referral welcome reward (referred by customer #${reward.referrerCustomerId})`
      );

      await db
        .update(crmReferralRewards)
        .set({
          status: 'PAID',
          refereeCustomerId: refereeCustomer.id,
          referrerLoyaltyTransactionId: referrerCredit.transactionId || null,
          refereeLoyaltyTransactionId: refereeCredit.transactionId || null,
          paidAt: new Date(),
        })
        .where(eq(crmReferralRewards.id, reward.id));

      await db.insert(crmReferralEvents).values({
        tenantId,
        referralCodeId: reward.referralCodeId,
        eventType: 'PURCHASED',
        metadata: { refereeCustomerId: refereeCustomer.id, invoiceId: purchase.id },
      });

      await db.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'REFERRAL_REDEEMED',
        aggregateType: 'CrmReferralReward',
        aggregateId: reward.id,
        tenantId,
        payload: {
          rewardId: reward.id,
          referrerCustomerId: reward.referrerCustomerId,
          refereeCustomerId: refereeCustomer.id,
          referrerPoints: reward.referrerPoints,
          refereePoints: reward.refereePoints,
        },
        published: false,
      });

      paidCount++;
    }

    return paidCount;
  }

  static async approveFlagged(
    db: ErpDatabase,
    tenantId: number,
    rewardId: number
  ): Promise<CrmReferralReward> {
    const [reward] = await db
      .select()
      .from(crmReferralRewards)
      .where(and(eq(crmReferralRewards.id, rewardId), eq(crmReferralRewards.tenantId, tenantId)));
    if (!reward) throw new NotFoundError('Referral reward', rewardId);
    if (reward.status !== 'FLAGGED') {
      throw new ValidationError('Only a FLAGGED reward can be approved');
    }

    const [updated] = await db
      .update(crmReferralRewards)
      .set({ status: 'PENDING', flagReason: null })
      .where(eq(crmReferralRewards.id, rewardId))
      .returning();
    if (!updated) throw new Error('Referral reward approval failed unexpectedly');
    return updated;
  }

  static async rejectFlagged(
    db: ErpDatabase,
    tenantId: number,
    rewardId: number,
    reason: string
  ): Promise<CrmReferralReward> {
    const [reward] = await db
      .select()
      .from(crmReferralRewards)
      .where(and(eq(crmReferralRewards.id, rewardId), eq(crmReferralRewards.tenantId, tenantId)));
    if (!reward) throw new NotFoundError('Referral reward', rewardId);
    if (reward.status !== 'FLAGGED') {
      throw new ValidationError('Only a FLAGGED reward can be rejected');
    }

    const [updated] = await db
      .update(crmReferralRewards)
      .set({ status: 'REJECTED', flagReason: reason })
      .where(eq(crmReferralRewards.id, rewardId))
      .returning();
    if (!updated) throw new Error('Referral reward rejection failed unexpectedly');
    return updated;
  }

  static async listRewards(
    db: ErpDatabase,
    tenantId: number,
    status?: 'PENDING' | 'FLAGGED' | 'PAID' | 'REJECTED'
  ): Promise<CrmReferralReward[]> {
    return db
      .select()
      .from(crmReferralRewards)
      .where(
        status
          ? and(eq(crmReferralRewards.tenantId, tenantId), eq(crmReferralRewards.status, status))
          : eq(crmReferralRewards.tenantId, tenantId)
      )
      .orderBy(sql`created_at DESC`);
  }

  /** Shared→clicked→signed-up→purchased funnel counts (Playwright scenario 4). */
  static async getFunnelStats(
    db: ErpDatabase,
    tenantId: number
  ): Promise<{
    clicked: number;
    signedUp: number;
    paid: number;
    flagged: number;
    rejected: number;
  }> {
    const [clickedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmReferralEvents)
      .where(
        and(eq(crmReferralEvents.tenantId, tenantId), eq(crmReferralEvents.eventType, 'CLICKED'))
      );

    const rewards = await db
      .select({ status: crmReferralRewards.status, count: sql<number>`count(*)::int` })
      .from(crmReferralRewards)
      .where(eq(crmReferralRewards.tenantId, tenantId))
      .groupBy(crmReferralRewards.status);

    const byStatus = Object.fromEntries(rewards.map((r) => [r.status, r.count]));
    return {
      clicked: clickedRow?.count ?? 0,
      signedUp:
        (byStatus['PENDING'] ?? 0) +
        (byStatus['FLAGGED'] ?? 0) +
        (byStatus['PAID'] ?? 0) +
        (byStatus['REJECTED'] ?? 0),
      paid: byStatus['PAID'] ?? 0,
      flagged: byStatus['FLAGGED'] ?? 0,
      rejected: byStatus['REJECTED'] ?? 0,
    };
  }
}
