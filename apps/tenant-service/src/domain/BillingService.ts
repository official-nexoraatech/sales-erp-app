import type { ErpDatabase } from '@erp/db';
import { tenants, planEntitlements, featureFlags } from '@erp/db';
import { createLogger } from '@erp/logger';
import { eq } from 'drizzle-orm';

const logger = createLogger({ serviceName: 'tenant-service' });

export type Plan = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

// PG-027 Session 1: entitlement-template copy logic only. No PaymentGatewayAdapter,
// no billing-cycle job yet (Session 2) — see the gap-prompt's "Next Session Plan".
export class BillingService {
  constructor(private readonly db: ErpDatabase) {}

  // Copies a plan_entitlements template into a tenant's settings (seat/branch caps) and
  // feature_flags override rows (the existing PlatformFeatureFlags enforcement mechanism),
  // then advances next_billing_date — same "template -> tenant copy" shape ROLE_DEFAULTS
  // already uses for roles. Re-running this (e.g. on plan change) re-copies the template,
  // so a tenant's entitlements never silently drift from what the current plan grants.
  async assignPlanEntitlements(tenantId: number, plan: Plan): Promise<void> {
    const [template] = await this.db.select().from(planEntitlements).where(eq(planEntitlements.plan, plan));
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

    logger.info({ tenantId, plan, flagCount: template.featureFlags.length }, 'Assigned plan entitlements');
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
}
