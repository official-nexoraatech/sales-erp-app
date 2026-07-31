import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  debitNotes: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    balanceAmount: 'balance_amount',
    appliedAmount: 'applied_amount',
    notes: 'notes',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
}));

import { DebitNoteService } from '../domain/DebitNoteService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'update', 'set', 'for']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  return chainable;
}

describe('DebitNoteService.apply', () => {
  const dnRow = {
    id: 8,
    tenantId: 1,
    status: 'OPEN',
    balanceAmount: '1180.00',
    appliedAmount: '0',
    notes: null,
  };

  it('marks status PARTIALLY_APPLIED when amount is less than the balance', async () => {
    const trx = makeTrx([[dnRow], undefined]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new DebitNoteService(db as never);

    const setSpy = trx['set'] as ReturnType<typeof vi.fn>;
    await svc.apply({ id: 8, tenantId: 1, amount: 500 });

    const setArg = setSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg['status']).toBe('PARTIALLY_APPLIED');
    expect(setArg['balanceAmount']).toBe('680');
  });

  it('marks status APPLIED when amount fully consumes the balance', async () => {
    const trx = makeTrx([[dnRow], undefined]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new DebitNoteService(db as never);

    const setSpy = trx['set'] as ReturnType<typeof vi.fn>;
    await svc.apply({ id: 8, tenantId: 1, amount: 1180 });

    const setArg = setSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg['status']).toBe('APPLIED');
    expect(setArg['balanceAmount']).toBe('0');
  });

  it('rejects an amount greater than the remaining balance', async () => {
    const trx = makeTrx([[dnRow]]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new DebitNoteService(db as never);

    await expect(svc.apply({ id: 8, tenantId: 1, amount: 5000 })).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_BALANCE',
    });
  });

  it('rejects applying against a debit note that is already fully APPLIED', async () => {
    const trx = makeTrx([[{ ...dnRow, status: 'APPLIED', balanceAmount: '0' }]]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new DebitNoteService(db as never);

    await expect(svc.apply({ id: 8, tenantId: 1, amount: 100 })).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
  });
});
