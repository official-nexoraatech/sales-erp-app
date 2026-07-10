import { and, eq, inArray } from 'drizzle-orm';
import { userRoles, rolePermissions, roles, userBranches } from '@erp/db';
import type { ErpDatabase } from '@erp/db';

export interface UserRolesAndPermissions {
  roleNames: string[];
  permissions: string[];
  branchIds: number[];
}

// Resolves the actual roles assigned to this user and only the permissions
// granted to those specific roles — NOT every permission in the tenant.
export async function loadUserRolesAndPermissions(
  db: ErpDatabase,
  userId: number,
  tenantId: number
): Promise<UserRolesAndPermissions> {
  const [userRoleRows, branchRows] = await Promise.all([
    db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId))),
    db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(and(eq(userBranches.userId, userId), eq(userBranches.tenantId, tenantId))),
  ]);

  const branchIds = branchRows.map((b) => b.branchId);
  const roleIds = userRoleRows.map((r) => r.roleId);
  if (roleIds.length === 0) return { roleNames: [], permissions: [], branchIds };

  const [roleRows, permRows] = await Promise.all([
    db
      .select({ name: roles.name })
      .from(roles)
      .where(and(inArray(roles.id, roleIds), eq(roles.tenantId, tenantId))),
    db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(and(inArray(rolePermissions.roleId, roleIds), eq(rolePermissions.tenantId, tenantId))),
  ]);

  return {
    roleNames: roleRows.map((r) => r.name),
    permissions: Array.from(new Set(permRows.map((r) => r.permission))),
    branchIds,
  };
}
