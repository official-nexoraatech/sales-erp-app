import { and, eq, sql } from 'drizzle-orm';
import { tenants, users, branches, type ErpDatabase } from '@erp/db';
import { BusinessError } from '@erp/types';

// PG-027 follow-up: tenants.settings.maxUsers/maxBranches are populated by
// BillingService.assignPlanEntitlements() at provisioning time but were never actually
// enforced anywhere (confirmed by repo-wide grep — see ERP-PLANNING gap doc
// 004-Platform/29-subscription-billing-license-management.md). NULL means unlimited
// (ENTERPRISE plan) — both checks fail open in that case, matching how the rest of the
// codebase treats a NULL/absent limit as "no cap," not as zero.
async function getMaxLimit(
  db: ErpDatabase,
  tenantId: number,
  key: 'maxUsers' | 'maxBranches'
): Promise<number | null> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return tenant?.settings?.[key] ?? null;
}

export async function assertUnderUserLimit(db: ErpDatabase, tenantId: number): Promise<void> {
  const max = await getMaxLimit(db, tenantId, 'maxUsers');
  if (max === null) return;

  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
  const current = row?.value ?? 0;

  if (current >= max) {
    throw new BusinessError(
      'PLAN_LIMIT_EXCEEDED',
      `Your plan allows up to ${max} users. Upgrade your plan to add more.`,
      { limit: 'maxUsers', max, current }
    );
  }
}

export async function assertUnderBranchLimit(db: ErpDatabase, tenantId: number): Promise<void> {
  const max = await getMaxLimit(db, tenantId, 'maxBranches');
  if (max === null) return;

  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)));
  const current = row?.value ?? 0;

  if (current >= max) {
    throw new BusinessError(
      'PLAN_LIMIT_EXCEEDED',
      `Your plan allows up to ${max} branches. Upgrade your plan to add more.`,
      { limit: 'maxBranches', max, current }
    );
  }
}
