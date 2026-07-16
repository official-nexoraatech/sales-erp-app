import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = (name: string) => ({ __name: name });
  return {
    tenants: mockTable('tenants'),
    users: mockTable('users'),
    branches: mockTable('branches'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: vi.fn(() => '__count__'),
}));

import { assertUnderUserLimit, assertUnderBranchLimit } from '../entitlements.js';
import { BusinessError } from '@erp/types';

/** Fake db resolving differently depending on which table `.from()` is given —
 * `tenants` for the settings lookup, `users`/`branches` for the count. */
function makeFakeDb(opts: {
  maxUsers: number | null;
  maxBranches: number | null;
  userCount: number;
  branchCount: number;
}) {
  return {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: () => {
          if (table.__name === 'tenants') {
            return Promise.resolve([
              { settings: { maxUsers: opts.maxUsers, maxBranches: opts.maxBranches } },
            ]);
          }
          if (table.__name === 'users') {
            return Promise.resolve([{ value: opts.userCount }]);
          }
          return Promise.resolve([{ value: opts.branchCount }]);
        },
      }),
    }),
  };
}

describe('assertUnderUserLimit', () => {
  it('allows when current count is under the plan limit', async () => {
    const db = makeFakeDb({ maxUsers: 5, maxBranches: 1, userCount: 3, branchCount: 0 });
    await expect(assertUnderUserLimit(db as never, 1)).resolves.toBeUndefined();
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when at the cap', async () => {
    const db = makeFakeDb({ maxUsers: 5, maxBranches: 1, userCount: 5, branchCount: 0 });
    const err = await assertUnderUserLimit(db as never, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect((err as BusinessError).code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('never rejects when maxUsers is null (ENTERPRISE / unlimited)', async () => {
    const db = makeFakeDb({ maxUsers: null, maxBranches: null, userCount: 999, branchCount: 999 });
    await expect(assertUnderUserLimit(db as never, 1)).resolves.toBeUndefined();
  });
});

describe('assertUnderBranchLimit', () => {
  it('allows when current count is under the plan limit', async () => {
    const db = makeFakeDb({ maxUsers: 25, maxBranches: 5, userCount: 0, branchCount: 3 });
    await expect(assertUnderBranchLimit(db as never, 1)).resolves.toBeUndefined();
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when at the cap', async () => {
    const db = makeFakeDb({ maxUsers: 25, maxBranches: 5, userCount: 0, branchCount: 5 });
    const err = await assertUnderBranchLimit(db as never, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect((err as BusinessError).code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('never rejects when maxBranches is null (ENTERPRISE / unlimited)', async () => {
    const db = makeFakeDb({ maxUsers: null, maxBranches: null, userCount: 999, branchCount: 999 });
    await expect(assertUnderBranchLimit(db as never, 1)).resolves.toBeUndefined();
  });
});
