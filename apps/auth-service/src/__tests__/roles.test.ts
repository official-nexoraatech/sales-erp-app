/**
 * Regression test for a privilege-escalation bug found while working on ES-19:
 * the permission-loading query used by login/refresh/MFA-verify/impersonation
 * filtered `rolePermissions` by tenantId only, never by the user's own roleId(s) —
 * so any user with at least one role received every permission assigned to
 * every role in the tenant, not just their own role's permissions.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  users: { __name: 'users' },
  userRoles: { __name: 'userRoles' },
  rolePermissions: { __name: 'rolePermissions' },
  roles: { __name: 'roles' },
  userBranches: { __name: 'userBranches' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({ __eq__: true })),
  and: (...conds: unknown[]) => ({ __and__: conds }),
  inArray: (_column: unknown, values: number[]) => ({ __inArray__: values }),
}));

import { userRoles, rolePermissions, roles, userBranches } from '@erp/db';
import { loadUserRolesAndPermissions } from '../domain/roles.js';

function extractRoleIds(cond: unknown): number[] {
  if (cond && typeof cond === 'object') {
    if ('__inArray__' in cond) return (cond as { __inArray__: number[] }).__inArray__;
    if ('__and__' in cond) {
      for (const sub of (cond as { __and__: unknown[] }).__and__) {
        const found = extractRoleIds(sub);
        if (found.length > 0) return found;
      }
    }
  }
  return [];
}

function makeFakeDb(state: {
  userRoles: { userId: number; roleId: number }[];
  roles: { id: number; name: string }[];
  rolePermissions: { roleId: number; permission: string }[];
  userBranches?: { userId: number; branchId: number }[];
}) {
  return {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: async (cond: unknown) => {
          if (table === userRoles) return state.userRoles;
          if (table === userBranches) return state.userBranches ?? [];
          if (table === roles) {
            const roleIds = extractRoleIds(cond);
            return state.roles.filter((r) => roleIds.includes(r.id));
          }
          if (table === rolePermissions) {
            const roleIds = extractRoleIds(cond);
            return state.rolePermissions.filter((p) => roleIds.includes(p.roleId));
          }
          return [];
        },
      }),
    }),
  };
}

describe('loadUserRolesAndPermissions', () => {
  it('only returns permissions granted to the user\'s own role, not every role in the tenant', async () => {
    const db = makeFakeDb({
      userRoles: [{ userId: 1, roleId: 10 }], // user 1 only has role 10 (STAFF)
      roles: [
        { id: 10, name: 'STAFF' },
        { id: 20, name: 'SUPER_ADMIN' },
      ],
      rolePermissions: [
        { roleId: 10, permission: 'INVOICE_VIEW' },
        { roleId: 20, permission: 'IMPERSONATE_USER' }, // belongs to a DIFFERENT role/user
        { roleId: 20, permission: 'VIEW_AUDIT_LOG' },
      ],
    });

    const result = await loadUserRolesAndPermissions(db as never, 1, 1);

    expect(result.roleNames).toEqual(['STAFF']);
    expect(result.permissions).toEqual(['INVOICE_VIEW']);
    expect(result.permissions).not.toContain('IMPERSONATE_USER');
    expect(result.permissions).not.toContain('VIEW_AUDIT_LOG');
  });

  it('returns empty roles/permissions for a user with no assigned roles', async () => {
    const db = makeFakeDb({ userRoles: [], roles: [], rolePermissions: [] });

    const result = await loadUserRolesAndPermissions(db as never, 99, 1);

    expect(result.roleNames).toEqual([]);
    expect(result.permissions).toEqual([]);
  });

  it('de-duplicates permissions shared across multiple assigned roles', async () => {
    const db = makeFakeDb({
      userRoles: [
        { userId: 1, roleId: 10 },
        { userId: 1, roleId: 11 },
      ],
      roles: [
        { id: 10, name: 'SALES_MANAGER' },
        { id: 11, name: 'ACCOUNTANT' },
      ],
      rolePermissions: [
        { roleId: 10, permission: 'INVOICE_VIEW' },
        { roleId: 11, permission: 'INVOICE_VIEW' },
        { roleId: 11, permission: 'JOURNAL_CREATE' },
      ],
    });

    const result = await loadUserRolesAndPermissions(db as never, 1, 1);

    expect(result.roleNames.sort()).toEqual(['ACCOUNTANT', 'SALES_MANAGER']);
    expect(result.permissions.sort()).toEqual(['INVOICE_VIEW', 'JOURNAL_CREATE']);
  });
});
