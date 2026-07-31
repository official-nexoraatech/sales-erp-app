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

// Distinct lock-key discriminators so a maxUsers lock never blocks a maxBranches check (or
// vice versa) for the same tenant — arbitrary, just needs to be stable and unique per limit.
const LOCK_KEY_DISCRIMINANT: Record<'maxUsers' | 'maxBranches', number> = {
  maxUsers: 1001,
  maxBranches: 1002,
};

// Postgres advisory transaction lock scoped to (tenantId, limit key). Must be called inside
// an open transaction — it's automatically released at commit/rollback, so a caller can never
// leak it by forgetting to release. Callers should acquire this *before* the count check and
// keep the same transaction open through the subsequent insert, so the check-then-insert
// sequence is serialized per tenant and can no longer race past the plan limit.
export async function acquireTenantLimitLock(
  db: ErpDatabase,
  tenantId: number,
  key: 'maxUsers' | 'maxBranches'
): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${LOCK_KEY_DISCRIMINANT[key]})`);
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
