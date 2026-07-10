import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy(
    {},
    { get: (_t, prop) => ({ columnName: String(prop) }) }
  );
  return { tenants: mockTable, createDatabaseClient: vi.fn() };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: { columnName: string }, b: unknown) => ({ type: 'eq', col: a.columnName, val: b })),
}));

import { initTenantStatusEnforcement, assertTenantActive, invalidateTenantStatusCache } from '../tenantStatus.js';
import { TenantSuspendedError, TenantClosedError, SecurityError } from '@erp/types';

interface Cond { col: string; val: unknown }

function makeFakeDb(tenantsById: Record<number, { status: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: (cond: Cond) => Promise.resolve(
          tenantsById[cond.val as number] ? [{ status: tenantsById[cond.val as number]!.status }] : []
        ),
      }),
    }),
  };
}

// Each test below uses a distinct tenantId — the module-level cache Map in
// tenantStatus.ts persists across tests in this file, so reusing an id would
// let an earlier test's cached result leak into a later assertion.
describe('assertTenantActive', () => {
  it('passes through silently for an ACTIVE tenant', async () => {
    initTenantStatusEnforcement(makeFakeDb({ 101: { status: 'ACTIVE' } }) as never);
    await expect(assertTenantActive(101, [])).resolves.toBeUndefined();
  });

  it('throws TenantSuspendedError for a SUSPENDED tenant', async () => {
    initTenantStatusEnforcement(makeFakeDb({ 102: { status: 'SUSPENDED' } }) as never);
    await expect(assertTenantActive(102, [])).rejects.toThrow(TenantSuspendedError);
  });

  it('throws TenantClosedError for a CLOSED tenant', async () => {
    initTenantStatusEnforcement(makeFakeDb({ 103: { status: 'CLOSED' } }) as never);
    await expect(assertTenantActive(103, [])).rejects.toThrow(TenantClosedError);
  });

  it('throws SecurityError when the tenant does not exist', async () => {
    initTenantStatusEnforcement(makeFakeDb({}) as never);
    await expect(assertTenantActive(999, [])).rejects.toThrow(SecurityError);
  });

  it('bypasses the check entirely for a caller holding PLATFORM_TENANT_MANAGE', async () => {
    // Even if the fake DB has no matching tenant (would otherwise throw SecurityError),
    // a platform operator must never be blocked by a customer-tenant lifecycle check.
    initTenantStatusEnforcement(makeFakeDb({}) as never);
    await expect(assertTenantActive(999, ['PLATFORM_TENANT_MANAGE'])).resolves.toBeUndefined();
  });

  it('serves a SUSPENDED result from cache within the TTL window without re-querying the DB', async () => {
    let queryCount = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            queryCount++;
            return Promise.resolve([{ status: 'SUSPENDED' }]);
          },
        }),
      }),
    };
    initTenantStatusEnforcement(db as never);

    await expect(assertTenantActive(104, [])).rejects.toThrow(TenantSuspendedError);
    await expect(assertTenantActive(104, [])).rejects.toThrow(TenantSuspendedError);

    expect(queryCount).toBe(1);
  });

  it('re-queries after invalidateTenantStatusCache clears the cached entry', async () => {
    let status = 'ACTIVE';
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ status }]),
        }),
      }),
    };
    initTenantStatusEnforcement(db as never);

    await expect(assertTenantActive(105, [])).resolves.toBeUndefined();

    status = 'SUSPENDED';
    invalidateTenantStatusCache(105);

    await expect(assertTenantActive(105, [])).rejects.toThrow(TenantSuspendedError);
  });
});
