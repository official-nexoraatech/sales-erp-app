import { and, eq, inArray } from 'drizzle-orm';
import { warehouses } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { getBranchScope } from '@erp/sdk';
import { ERPError } from '@erp/types';

// Inventory module audit 2026-07-21: warehouses carry a branchId, and JWTs carry the
// caller's branchIds, but no inventory route ever filtered/checked it — any user holding a
// tenant-wide permission (WAREHOUSE_VIEW/STOCK_VIEW/STOCK_ADJUST/STOCK_TRANSFER/etc.) could
// view or act on ANY branch's warehouse, not just their own. Warehouses (and everything keyed
// off warehouseId — stock levels, adjustments, transfers, physical verifications) have no
// branchId column of their own, so scoping has to resolve through warehouses.branch_id rather
// than filtering a column directly (contrast [[es24_saga_orchestrator_design]]-era branch
// scoping on tables that already carry branchId, e.g. invoices).

export type WarehouseScope = 'all' | number[];

// Returns 'all' if the caller isn't branch-restricted (BRANCH_SCOPE_BYPASS, or no branch
// assignments at all — see getBranchScope's own doc comment for why that's not a lockout),
// otherwise the specific warehouse ids the caller's branches actually own.
export async function getWarehouseScope(
  db: ErpDatabase,
  tenantId: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<WarehouseScope> {
  const branchScope = getBranchScope(auth);
  if (branchScope === 'all') return 'all';

  const rows = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.branchId, branchScope)));
  return rows.map((r) => r.id);
}

// Throws if the given warehouse isn't within the caller's branch scope. Callers still need
// their own eq(warehouses.tenantId, tenantId) existence check — this only answers "is it in
// scope", not "does it exist".
export async function assertWarehouseInScope(
  db: ErpDatabase,
  tenantId: number,
  warehouseId: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const scope = await getWarehouseScope(db, tenantId, auth);
  if (scope === 'all') return;
  if (!scope.includes(warehouseId)) {
    throw new ERPError(
      'WAREHOUSE_OUT_OF_SCOPE',
      'Warehouse is outside your assigned branch(es)',
      403
    );
  }
}

// Cheaper variant for routes that already have the warehouse row in hand (its branchId is
// known without a second query) — e.g. warehouse.routes.ts's own GET/PUT/DELETE :id handlers.
export function assertBranchInScope(
  branchId: number,
  auth: { permissions: string[]; branchIds: number[] }
): void {
  const scope = getBranchScope(auth);
  if (scope === 'all') return;
  if (!scope.includes(branchId)) {
    throw new ERPError(
      'WAREHOUSE_OUT_OF_SCOPE',
      'Warehouse is outside your assigned branch(es)',
      403
    );
  }
}
