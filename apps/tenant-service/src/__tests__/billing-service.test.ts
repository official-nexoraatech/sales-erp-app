// PG-027 Session 1 — BillingService entitlement-copy logic.
// See [[erp_db_vitest_barrel_export_bug]]: @erp/db's export * barrel can silently
// resolve stale/truncated symbols under vitest, so both @erp/db and drizzle-orm are
// mocked with minimal stand-ins rather than trusting real module resolution.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  tenants: { __name: 'tenants' },
  planEntitlements: { __name: 'plan_entitlements' },
  featureFlags: { __name: 'feature_flags', tenantId: 'tenantId', flagKey: 'flagKey' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
}));

vi.mock('@erp/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { BillingService } from '../domain/BillingService.js';

interface FakeTemplate {
  plan: string;
  maxUsers: number | null;
  maxBranches: number | null;
  featureFlags: string[];
  billingPeriod: 'MONTHLY' | 'ANNUAL';
}

interface FakeTenant {
  id: number;
  plan: string;
  settings: Record<string, unknown>;
}

function makeFakeDb(opts: { template?: FakeTemplate; tenant?: FakeTenant }): {
  db: Record<string, unknown>;
  state: { tenant?: FakeTenant; tenantUpdates: Record<string, unknown>[]; flagUpserts: Record<string, unknown>[] };
} {
  const state: {
    tenant?: FakeTenant;
    tenantUpdates: Record<string, unknown>[];
    flagUpserts: Record<string, unknown>[];
  } = { tenant: opts.tenant, tenantUpdates: [], flagUpserts: [] };

  const db = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: async () => {
          if (table.__name === 'plan_entitlements') return opts.template ? [opts.template] : [];
          if (table.__name === 'tenants') return state.tenant ? [state.tenant] : [];
          return [];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          state.tenantUpdates.push(patch);
          if (state.tenant) Object.assign(state.tenant, patch);
          return [];
        },
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          state.flagUpserts.push(row);
          return [];
        },
      }),
    }),
  };

  return { db, state };
}

describe('BillingService.assignPlanEntitlements', () => {
  it('copies maxUsers/maxBranches from the plan template into tenant settings', async () => {
    const template: FakeTemplate = {
      plan: 'GROWTH',
      maxUsers: 25,
      maxBranches: 5,
      featureFlags: [],
      billingPeriod: 'MONTHLY',
    };
    const tenant: FakeTenant = { id: 1, plan: 'STARTER', settings: { timezone: 'Asia/Kolkata' } };
    const { db, state } = makeFakeDb({ template, tenant });

    await new BillingService(db as never).assignPlanEntitlements(1, 'GROWTH');

    expect(state.tenantUpdates).toHaveLength(1);
    const patch = state.tenantUpdates[0]!;
    expect(patch['settings']).toEqual({ timezone: 'Asia/Kolkata', maxUsers: 25, maxBranches: 5 });
    expect(patch['plan']).toBe('GROWTH');
  });

  it('unsets maxUsers/maxBranches (unlimited) when the template value is null', async () => {
    const template: FakeTemplate = {
      plan: 'ENTERPRISE',
      maxUsers: null,
      maxBranches: null,
      featureFlags: [],
      billingPeriod: 'MONTHLY',
    };
    const tenant: FakeTenant = { id: 1, plan: 'GROWTH', settings: { maxUsers: 25, maxBranches: 5 } };
    const { db, state } = makeFakeDb({ template, tenant });

    await new BillingService(db as never).assignPlanEntitlements(1, 'ENTERPRISE');

    const patch = state.tenantUpdates[0]!;
    expect(patch['settings']).toEqual({});
  });

  it('writes one feature_flags upsert row per template flag, enabled true', async () => {
    const template: FakeTemplate = {
      plan: 'GROWTH',
      maxUsers: 25,
      maxBranches: 5,
      featureFlags: ['gst.e-invoice.enabled', 'pos.enabled'],
      billingPeriod: 'MONTHLY',
    };
    const tenant: FakeTenant = { id: 7, plan: 'STARTER', settings: {} };
    const { db, state } = makeFakeDb({ template, tenant });

    await new BillingService(db as never).assignPlanEntitlements(7, 'GROWTH');

    expect(state.flagUpserts).toHaveLength(2);
    expect(state.flagUpserts).toEqual([
      { tenantId: 7, flagKey: 'gst.e-invoice.enabled', enabled: true },
      { tenantId: 7, flagKey: 'pos.enabled', enabled: true },
    ]);
  });

  it('throws when no plan_entitlements template exists for the plan', async () => {
    const tenant: FakeTenant = { id: 1, plan: 'STARTER', settings: {} };
    const { db } = makeFakeDb({ tenant });

    await expect(new BillingService(db as never).assignPlanEntitlements(1, 'GROWTH')).rejects.toThrow(
      'No plan_entitlements template found for plan "GROWTH"'
    );
  });

  it('throws when the tenant does not exist', async () => {
    const template: FakeTemplate = {
      plan: 'STARTER',
      maxUsers: 5,
      maxBranches: 1,
      featureFlags: [],
      billingPeriod: 'MONTHLY',
    };
    const { db } = makeFakeDb({ template });

    await expect(new BillingService(db as never).assignPlanEntitlements(99, 'STARTER')).rejects.toThrow(
      'Tenant 99 not found'
    );
  });
});

describe('BillingService.computeNextBillingDate', () => {
  const svc = new BillingService({} as never);

  it('advances by one month for MONTHLY', () => {
    const next = svc.computeNextBillingDate(new Date('2026-07-10T00:00:00Z'), 'MONTHLY');
    expect(next).toBe('2026-08-10');
  });

  it('advances by one year for ANNUAL', () => {
    const next = svc.computeNextBillingDate(new Date('2026-07-10T00:00:00Z'), 'ANNUAL');
    expect(next).toBe('2027-07-10');
  });
});
