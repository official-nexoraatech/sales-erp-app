import type { ErpDatabase } from '@erp/db';
import { tenants, planEntitlements, featureFlags, tenantInvoices, auditLog } from '@erp/db';
import { createLogger } from '@erp/logger';
import { createHash } from 'node:crypto';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { PaymentGatewayAdapter } from './PaymentGatewayAdapter.js';
import type { PlatformContextFactory } from '@erp/sdk';
import { invalidateTenantStatusCache } from '@erp/sdk';

// System-actor sentinel for automated (non-HTTP-request) tenant-lifecycle actions — mirrors the
// userId:0 "system" convention already used elsewhere in this codebase (e.g. accounting-service's
// scheduler-internal routes) for actions with no real acting user in request.auth.
const SYSTEM_USER_ID = 0;

const logger = createLogger({ serviceName: 'tenant-service' });

export type Plan = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export type ChargeOutcome = 'PAID' | 'FAILED' | 'SKIPPED_NO_GATEWAY_REF' | 'SKIPPED_NO_PRICE';

export interface DunningResult {
  action: 'NONE' | 'STARTED' | 'STILL_WAITING' | 'GRACE_ELAPSED';
}

// PG-027 Session 1: entitlement-template copy logic only. No PaymentGatewayAdapter,
// no billing-cycle job yet (Session 2) — see the gap-prompt's "Next Session Plan".
// Single-owner rule (Capability Foundation, Phase 1): this class is the sole writer of
// entitlement-derived feature_flags rows — any future plan-change route must call a method
// on this class rather than writing feature_flags directly from a route handler or script.
export class BillingService {
  constructor(private readonly db: ErpDatabase) {}

  // Copies a plan_entitlements template into a tenant's settings (seat/branch caps) and
  // feature_flags override rows (the existing PlatformFeatureFlags enforcement mechanism),
  // then advances next_billing_date — same "template -> tenant copy" shape ROLE_DEFAULTS
  // already uses for roles. Re-running this (e.g. on plan change) re-copies the template,
  // so a tenant's entitlements never silently drift from what the current plan grants.
  async assignPlanEntitlements(tenantId: number, plan: Plan): Promise<void> {
    const [template] = await this.db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.plan, plan));
    if (!template) {
      throw new Error(`No plan_entitlements template found for plan "${plan}"`);
    }

    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const settings: typeof tenant.settings = { ...tenant.settings };
    if (template.maxUsers !== null) {
      settings.maxUsers = template.maxUsers;
    } else {
      delete settings.maxUsers;
    }
    if (template.maxBranches !== null) {
      settings.maxBranches = template.maxBranches;
    } else {
      delete settings.maxBranches;
    }

    await this.db
      .update(tenants)
      .set({
        plan,
        settings,
        nextBillingDate: this.computeNextBillingDate(new Date(), template.billingPeriod),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    for (const flagKey of template.featureFlags) {
      await this.db
        .insert(featureFlags)
        .values({ tenantId, flagKey, enabled: true })
        .onConflictDoUpdate({
          target: [featureFlags.tenantId, featureFlags.flagKey],
          set: { enabled: true, updatedAt: new Date() },
        });
    }

    logger.info(
      { tenantId, plan, flagCount: template.featureFlags.length },
      'Assigned plan entitlements'
    );
  }

  computeNextBillingDate(from: Date, billingPeriod: 'MONTHLY' | 'ANNUAL'): string {
    const next = new Date(from);
    if (billingPeriod === 'ANNUAL') {
      next.setUTCFullYear(next.getUTCFullYear() + 1);
    } else {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }
    return next.toISOString().slice(0, 10);
  }

  // PG-027 Session 2: generates a PENDING tenant_invoices row for the period starting at the
  // tenant's current next_billing_date, snapshotting plan/amount so a later plan change never
  // silently alters an already-generated invoice. Returns null (not an error) if the tenant's
  // plan has no monthly_price_paise configured yet — pricing is a business decision this package
  // deliberately doesn't invent (see the gap-prompt's own "Assumption to confirm" note); an
  // unpriced plan simply isn't billed, rather than billed for an arbitrary placeholder amount.
  async generateInvoice(tenantId: number): Promise<number | null> {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    if (!tenant.nextBillingDate) return null;

    const [template] = await this.db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.plan, tenant.plan));
    if (!template || template.monthlyPricePaise === null) {
      logger.info(
        { tenantId, plan: tenant.plan },
        'Skipping invoice — plan has no price configured'
      );
      return null;
    }

    const periodStart = tenant.nextBillingDate;
    const periodEnd = this.computeNextBillingDate(new Date(periodStart), template.billingPeriod);

    const [row] = await this.db
      .insert(tenantInvoices)
      .values({
        tenantId,
        plan: tenant.plan,
        amountPaise: template.monthlyPricePaise,
        currency: 'INR',
        status: 'PENDING',
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
      })
      .returning({ id: tenantInvoices.id });

    logger.info(
      { tenantId, invoiceId: row?.id, amountPaise: template.monthlyPricePaise },
      'Tenant invoice generated'
    );
    return row?.id ?? null;
  }

  // Charges a PENDING invoice via the given gateway adapter. Idempotency key is derived from the
  // invoice id (SHA-256, same pattern notification-service already uses for delivery dedup) —
  // a scheduler-job retry against the same invoiceId must never double-charge.
  async chargeInvoice(
    invoiceId: number,
    gatewayAdapter: PaymentGatewayAdapter
  ): Promise<ChargeOutcome> {
    const [invoice] = await this.db
      .select()
      .from(tenantInvoices)
      .where(eq(tenantInvoices.id, invoiceId));
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status === 'PAID') return 'PAID'; // already settled — idempotent no-op

    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, invoice.tenantId));
    if (!tenant?.paymentGatewayCustomerRef) {
      logger.warn(
        { invoiceId, tenantId: invoice.tenantId },
        'No saved payment method — cannot charge'
      );
      return 'SKIPPED_NO_GATEWAY_REF';
    }

    const idempotencyKey = createHash('sha256').update(`tenant-invoice-${invoiceId}`).digest('hex');
    const result = await gatewayAdapter.charge({
      tenantId: invoice.tenantId,
      amountPaise: invoice.amountPaise,
      currency: invoice.currency,
      customerRef: tenant.paymentGatewayCustomerRef,
      idempotencyKey,
    });

    if (result.success) {
      await this.db
        .update(tenantInvoices)
        .set({
          status: 'PAID',
          paymentGatewayRef: result.gatewayRef,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tenantInvoices.id, invoiceId));
      await this.db
        .update(tenants)
        .set({
          nextBillingDate: this.computeNextBillingDate(
            new Date(invoice.billingPeriodEnd),
            'MONTHLY'
          ),
          dunningStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, invoice.tenantId));
      logger.info({ invoiceId, tenantId: invoice.tenantId }, 'Invoice charged successfully');
      return 'PAID';
    }

    await this.db
      .update(tenantInvoices)
      .set({
        status: 'FAILED',
        // Persisted even on failure (when non-empty) — lets a later async webhook for the same
        // gateway order/reference correlate back to this invoice (see billing-webhook.routes.ts).
        ...(result.gatewayRef ? { paymentGatewayRef: result.gatewayRef } : {}),
        failureReason: result.failureReason,
        updatedAt: new Date(),
      })
      .where(eq(tenantInvoices.id, invoiceId));
    logger.warn(
      { invoiceId, tenantId: invoice.tenantId, reason: result.failureReason },
      'Invoice charge failed'
    );
    return 'FAILED';
  }

  // Starts (if unset) or checks (if already running) the dunning clock for a tenant with a
  // failed payment. Returns 'GRACE_ELAPSED' once graceDays have passed since dunning started —
  // the caller (billing-internal.routes.ts) is responsible for actually suspending the tenant,
  // mirroring the existing PATCH /admin/tenants/:id/suspend route's own
  // suspend→invalidate-cache→publish-invalidation→audit-log sequence rather than duplicating it
  // inside this domain service.
  async startOrCheckDunning(tenantId: number, graceDays = 7): Promise<DunningResult> {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    if (!tenant.dunningStartedAt) {
      await this.db
        .update(tenants)
        .set({ dunningStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      logger.info({ tenantId }, 'Dunning started');
      return { action: 'STARTED' };
    }

    const elapsedMs = Date.now() - tenant.dunningStartedAt.getTime();
    if (elapsedMs >= graceDays * 24 * 60 * 60 * 1000) {
      return { action: 'GRACE_ELAPSED' };
    }
    return { action: 'STILL_WAITING' };
  }

  // Suspends a tenant for non-payment, mirroring the exact sequence the existing
  // `PATCH /admin/tenants/:id/suspend` route uses (suspend → invalidate local cache → publish
  // cross-process invalidation → audit log) — reimplemented here rather than constructing a full
  // TenantProvisioner (which needs an unrelated searchServiceUrl/storageClient) just to call one
  // simple, already-guarded DB update.
  async suspendForNonPayment(
    tenantId: number,
    ctxFactory: PlatformContextFactory
  ): Promise<boolean> {
    const result = await this.db
      .update(tenants)
      .set({
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendedBy: SYSTEM_USER_ID,
        suspendedReason: 'PAYMENT_OVERDUE',
        updatedAt: new Date(),
        version: sql`${tenants.version} + 1`,
      })
      .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'ACTIVE')))
      .returning({ id: tenants.id });

    if (result.length === 0) return false; // already suspended/closed — no-op, matching suspend()'s own guard

    invalidateTenantStatusCache(tenantId);
    await ctxFactory.publishTenantStatusInvalidation(tenantId);
    await this.db.insert(auditLog).values({
      tenantId,
      userId: SYSTEM_USER_ID,
      action: 'TENANT_SUSPENDED',
      entityType: 'tenant',
      entityId: tenantId,
      beforeData: { status: 'ACTIVE' },
      afterData: { status: 'SUSPENDED' },
      metadata: { reason: 'PAYMENT_OVERDUE' },
      actorEmail: 'system@platform',
      ipAddress: 'internal',
      changedFields: ['status'],
    });
    logger.warn({ tenantId }, 'Tenant suspended for non-payment');
    return true;
  }

  // Tenants due for billing today: next_billing_date in the past, not yet CLOSED (a closed
  // tenant should never be re-billed; a SUSPENDED one still needs the cycle to keep running so
  // a late payment can lift the suspension once PG-028/retry-payment lands).
  async findTenantsDueForBilling(): Promise<{ id: number }[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(
        and(
          // SUSPENDED tenants are intentionally excluded from the automatic daily cycle — a
          // later payment on an already-suspended tenant is Session 3's manual "retry-payment"
          // admin action (POST /admin/tenants/:id/invoices/:invoiceId/retry-payment), not an
          // automatic daily re-attempt. A CLOSED tenant is never re-billed at all.
          eq(tenants.status, 'ACTIVE'),
          isNotNull(tenants.nextBillingDate),
          lte(tenants.nextBillingDate, today)
        )
      );
  }
}
