import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  invoices: {
    __name: 'invoices',
    id: { columnName: 'id' },
    tenantId: { columnName: 'tenantId' },
    grandTotal: { columnName: 'grandTotal' },
  },
  einvoiceData: {
    __name: 'einvoiceData',
    tenantId: { columnName: 'tenantId' },
    invoiceId: { columnName: 'invoiceId' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: { columnName: string }, b: unknown) => ({ type: 'eq', col: a.columnName, val: b })),
  and: vi.fn((...args: Array<{ type: string; col?: string; val?: unknown }>) => ({ type: 'and', args })),
}));

import { createGstComplianceStepFactory, GST_COMPLIANCE_SAGA_TYPE, EWB_VALUE_THRESHOLD } from '../../sagas/gst-compliance.js';
import type { GstComplianceActionDeps } from '../../sagas/gst-compliance.js';
import type { ErpDatabase } from '@erp/db';

interface Cond { type: string; col?: string; val?: unknown; args?: Cond[] }

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.type === 'and') return (cond.args ?? []).every((c) => matches(row, c));
  return row[cond.col!] === cond.val;
}

function makeFakeDb(invoiceRows: Array<Record<string, unknown>>) {
  const einvoiceRows: Array<Record<string, unknown>> = [];
  const db = {
    einvoiceRows,
    select: (_projection?: Record<string, unknown>) => ({
      from: (table: { __name: string }) => ({
        where: (cond: Cond) => ({
          limit: (_n: number) =>
            Promise.resolve((table.__name === 'invoices' ? invoiceRows : einvoiceRows).filter((r) => matches(r, cond))),
        }),
      }),
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          const rows = table.__name === 'invoices' ? invoiceRows : einvoiceRows;
          rows.filter((r) => matches(r, cond)).forEach((r) => Object.assign(r, patch));
          return Promise.resolve();
        },
      }),
    }),
  };
  return db as unknown as ErpDatabase;
}

function makeDeps(calls: string[]): GstComplianceActionDeps {
  return {
    generateIrn: async () => { calls.push('generateIrn'); },
    cancelIrn: async () => { calls.push('cancelIrn'); },
    generateEwayBill: async () => { calls.push('generateEwayBill'); },
  };
}

describe('createGstComplianceStepFactory', () => {
  it('builds only the generate_irn step for an invoice at or below the EWB threshold', async () => {
    const db = makeFakeDb([{ id: 1, tenantId: 1, grandTotal: String(EWB_VALUE_THRESHOLD) }]);
    const calls: string[] = [];
    const factory = createGstComplianceStepFactory(db, makeDeps(calls));

    const { steps, context } = await factory({ invoiceId: 1, userId: 5, correlationId: 'c1' }, 1);

    expect(steps.map((s) => s.name)).toEqual(['generate_irn']);
    expect(context).toEqual({ tenantId: 1, userId: 5, invoiceId: 1, correlationId: 'c1' });
  });

  it('builds both steps for an invoice over the EWB threshold', async () => {
    const db = makeFakeDb([{ id: 2, tenantId: 1, grandTotal: String(EWB_VALUE_THRESHOLD + 1) }]);
    const factory = createGstComplianceStepFactory(db, makeDeps([]));

    const { steps } = await factory({ invoiceId: 2, userId: 5, correlationId: 'c1' }, 1);

    expect(steps.map((s) => s.name)).toEqual(['generate_irn', 'generate_eway_bill']);
    expect(steps.every((s) => s.type === 'COMPENSATABLE')).toBe(true);
  });

  it('generate_irn.compensate calls deps.cancelIrn', async () => {
    const db = makeFakeDb([{ id: 3, tenantId: 1, grandTotal: '10' }]);
    const calls: string[] = [];
    const factory = createGstComplianceStepFactory(db, makeDeps(calls));
    const { steps, context } = await factory({ invoiceId: 3, userId: 5, correlationId: 'c1' }, 1);

    await steps[0]!.compensate!(context);
    expect(calls).toEqual(['cancelIrn']);
  });

  it('generate_eway_bill.compensate flags the einvoice_data row for manual review instead of calling NIC', async () => {
    const db = makeFakeDb([{ id: 4, tenantId: 1, grandTotal: String(EWB_VALUE_THRESHOLD + 1) }]) as ErpDatabase & {
      einvoiceRows: Array<Record<string, unknown>>;
    };
    (db as unknown as { einvoiceRows: Array<Record<string, unknown>> }).einvoiceRows.push({ tenantId: 1, invoiceId: 4 });

    const calls: string[] = [];
    const factory = createGstComplianceStepFactory(db, makeDeps(calls));
    const { steps, context } = await factory({ invoiceId: 4, userId: 5, correlationId: 'c1' }, 1);

    const ewbStep = steps.find((s) => s.name === 'generate_eway_bill')!;
    await ewbStep.compensate!(context);

    expect(calls).not.toContain('generateEwayBill');
    const row = (db as unknown as { einvoiceRows: Array<Record<string, unknown>> }).einvoiceRows[0]!;
    expect(row['ewbStatus']).toBe('EWB_GENERATION_FAILED_MANUAL_REVIEW');
  });

  it('throws when the invoice is not found for the given tenant', async () => {
    const db = makeFakeDb([]);
    const factory = createGstComplianceStepFactory(db, makeDeps([]));

    await expect(factory({ invoiceId: 999, userId: 5, correlationId: 'c1' }, 1)).rejects.toThrow();
  });

  it('exposes the saga type constant used for registration', () => {
    expect(GST_COMPLIANCE_SAGA_TYPE).toBe('GST_COMPLIANCE_GENERATION');
  });
});
