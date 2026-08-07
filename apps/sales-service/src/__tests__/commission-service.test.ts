/**
 * Business Rules Engine, Commission category: CommissionService computes a DRAFT
 * commission_ledger row for a confirmed invoice when the invoice's creator (or their branch,
 * as a fallback) has an active commission assignment, then approve() posts it to GL via the
 * COMMISSION_APPROVED outbox event (accounting-service's CommissionAccountingConsumer).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  invoices: {
    id: 'id',
    tenantId: 'tenant_id',
    branchId: 'branch_id',
    createdBy: 'created_by',
    taxableAmount: 'taxable_amount',
    grandTotal: 'grand_total',
  },
  commissionPlans: {
    id: 'id',
    tenantId: 'tenant_id',
    isActive: 'is_active',
  },
  commissionAssignments: {
    id: 'id',
    tenantId: 'tenant_id',
    userId: 'user_id',
    roleName: 'role_name',
    branchId: 'branch_id',
    isActive: 'is_active',
    planId: 'plan_id',
  },
  commissionLedger: {
    id: 'id',
    tenantId: 'tenant_id',
    invoiceId: 'invoice_id',
    status: 'status',
    createdAt: 'created_at',
    earnedByUserId: 'earned_by_user_id',
  },
  outboxEvents: {},
  businessRules: {
    tenantId: 'tenant_id',
    entityType: 'entity_type',
    eventType: 'event_type',
    isActive: 'is_active',
    priority: 'priority',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  or: vi.fn((...args) => ({ type: 'or', args })),
  isNull: vi.fn((col) => ({ type: 'isNull', col })),
  desc: vi.fn((col) => ({ type: 'desc', col })),
}));

import { CommissionService } from '../domain/CommissionService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'update',
    'set',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  return chainable;
}

function makeDb(script: unknown[]) {
  const trx = makeTrx(script);
  return {
    ...trx,
    transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
  };
}

const invoiceRow = {
  branchId: 1,
  createdBy: 42,
  taxableAmount: '10000.00',
  grandTotal: '11800.00',
};

const assignmentRow = {
  id: 5,
  tenantId: 1,
  planId: 9,
  userId: 42,
  branchId: null,
  isActive: true,
};

describe('CommissionService.computeForInvoice', () => {
  it('records a DRAFT commission_ledger row for a PERCENTAGE plan when an assignment matches', async () => {
    const planRow = {
      id: 9,
      calculationBasis: 'PERCENTAGE',
      ratePct: '5.00',
      effectiveFrom: new Date('2020-01-01'),
      effectiveTill: null,
      isActive: true,
    };
    const script = [
      [invoiceRow], // select invoices
      [assignmentRow], // select commissionAssignments
      [planRow], // select commissionPlans
      [], // RuleEngine.evaluate(): select businessRules — none seeded, no-op (not blocked)
      undefined, // insert commissionLedger
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    await svc.computeForInvoice(1, 1);

    const valuesCall = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(valuesCall).toMatchObject({
      invoiceId: 1,
      planId: 9,
      assignmentId: 5,
      earnedByUserId: 42,
      status: 'DRAFT',
      commissionAmount: '500', // 10000 * 5%
    });
  });

  it('falls back to the branch-default assignment when no user-specific one matches (regression: NULLS-FIRST-on-DESC bug)', async () => {
    const branchAssignment = {
      id: 6,
      tenantId: 1,
      planId: 9,
      userId: null,
      branchId: 1,
      isActive: true,
    };
    const planRow = {
      id: 9,
      calculationBasis: 'PERCENTAGE',
      ratePct: '2.00',
      effectiveFrom: new Date('2020-01-01'),
      effectiveTill: null,
      isActive: true,
    };
    const script = [
      [invoiceRow], // select invoices
      [], // select commissionAssignments by userId — no match for this creator
      [branchAssignment], // select commissionAssignments by branch fallback — matches
      [planRow], // select commissionPlans
      [], // RuleEngine.evaluate(): no seeded rules, no-op
      undefined, // insert commissionLedger
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    await svc.computeForInvoice(1, 1);

    const valuesCall = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(valuesCall).toMatchObject({ assignmentId: 6, commissionAmount: '200' }); // 10000 * 2%
  });

  it('no-ops when no active commission assignment matches the invoice', async () => {
    const script = [
      [invoiceRow], // select invoices
      [], // select commissionAssignments by userId — none
      [], // select commissionAssignments by branch fallback — none either
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    await svc.computeForInvoice(1, 1);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('no-ops when a business rule blocks commission eligibility for this invoice', async () => {
    const planRow = {
      id: 9,
      calculationBasis: 'PERCENTAGE',
      ratePct: '5.00',
      effectiveFrom: new Date('2020-01-01'),
      effectiveTill: null,
      isActive: true,
    };
    const script = [
      [invoiceRow],
      [assignmentRow],
      [planRow],
      // RuleEngine.evaluate(): a tenant-authored rule blocks commission for this invoice
      // (e.g. "no commission on invoices under a promo threshold")
      [
        {
          id: 1,
          name: 'No commission during promo period',
          entityType: 'COMMISSION',
          eventType: 'INVOICE_CONFIRMED',
          conditionOperator: 'AND',
          conditions: [{ field: 'baseAmount', operator: 'GREATER_THAN', value: 0 }],
          actions: [{ type: 'BLOCK', message: 'Promo period — no commission' }],
          priority: 1,
          isActive: true,
        },
      ],
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    await svc.computeForInvoice(1, 1);

    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('CommissionService.createPlan / listPlans', () => {
  it('creates a PERCENTAGE plan with the given rate and effective window', async () => {
    const createdRow = {
      id: 1,
      tenantId: 1,
      name: 'Standard 5%',
      calculationBasis: 'PERCENTAGE',
      ratePct: '5',
    };
    const db = makeDb([[createdRow]]);
    const svc = new CommissionService(db as never);

    const row = await svc.createPlan(1, 99, {
      name: 'Standard 5%',
      calculationBasis: 'PERCENTAGE',
      ratePct: 5,
      effectiveFrom: new Date('2026-01-01'),
    });

    expect(row).toMatchObject({ id: 1, name: 'Standard 5%' });
    const valuesCall = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(valuesCall).toMatchObject({ tenantId: 1, createdBy: 99, ratePct: '5' });
  });

  it('lists plans for the tenant, most recent first', async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    const db = makeDb([rows]);
    const svc = new CommissionService(db as never);

    const result = await svc.listPlans(1);

    expect(result).toEqual(rows);
  });
});

describe('CommissionService.createAssignment / listAssignments', () => {
  it('creates a user-level assignment pointing at an existing plan', async () => {
    const script = [
      [{ id: 9 }], // select commissionPlans — plan exists
      [{ id: 5, tenantId: 1, planId: 9, userId: 42 }], // insert ... returning
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    const row = await svc.createAssignment(1, 99, { planId: 9, userId: 42 });

    expect(row).toMatchObject({ id: 5, userId: 42 });
  });

  it('rejects an assignment specifying neither userId, roleName, nor branchId', async () => {
    const db = makeDb([]);
    const svc = new CommissionService(db as never);

    await expect(svc.createAssignment(1, 99, { planId: 9 })).rejects.toMatchObject({
      code: 'INVALID_ASSIGNMENT',
    });
  });

  it('rejects an assignment specifying more than one of userId/roleName/branchId', async () => {
    const db = makeDb([]);
    const svc = new CommissionService(db as never);

    await expect(
      svc.createAssignment(1, 99, { planId: 9, userId: 42, branchId: 1 })
    ).rejects.toMatchObject({ code: 'INVALID_ASSIGNMENT' });
  });

  it('rejects an assignment pointing at a plan that does not exist for this tenant', async () => {
    const db = makeDb([[]]); // select commissionPlans — none found
    const svc = new CommissionService(db as never);

    await expect(svc.createAssignment(1, 99, { planId: 999, branchId: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lists assignments for the tenant, most recent first', async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    const db = makeDb([rows]);
    const svc = new CommissionService(db as never);

    const result = await svc.listAssignments(1);

    expect(result).toEqual(rows);
  });
});

describe('CommissionService.approve', () => {
  it('transitions DRAFT to APPROVED and publishes COMMISSION_APPROVED', async () => {
    const script = [
      [{ id: 1, invoiceId: 7, earnedByUserId: 42, commissionAmount: '500' }], // update...returning (claimed)
      undefined, // insert outboxEvents
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    await svc.approve(1, 1, 99);

    const eventValues = (db.values as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as { eventType?: string })?.eventType === 'COMMISSION_APPROVED'
    )?.[0];
    expect(eventValues).toMatchObject({ eventType: 'COMMISSION_APPROVED', tenantId: 1 });
  });

  it('rejects approving a commission that is not DRAFT', async () => {
    const script = [
      [], // update...returning — no row claimed (already APPROVED/PAID)
      [{ status: 'APPROVED' }], // fallback select to report the real status
    ];
    const db = makeDb(script);
    const svc = new CommissionService(db as never);

    await expect(svc.approve(1, 1, 99)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});
