/**
 * C-2 fix: gst_ledger is append-only and previously had no reversal path at all — cancelling
 * a CONFIRMED invoice never offset the SALES_INVOICE row written at confirm time, so GSTR-1/3B
 * outward-tax figures permanently included every invoice that reached CONFIRMED before being
 * cancelled. GstLedgerService.reverseSalesInvoiceEntry() now reads back the original entry's
 * own amounts/split (not the GST-detail-free INVOICE_CANCELLED payload) and posts an
 * offsetting entry.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  gte: vi.fn(),
  lte: vi.fn(),
  inArray: vi.fn(),
  sql: (strings: TemplateStringsArray) => strings,
}));

vi.mock('@erp/db', () => ({
  gstLedger: {
    id: 'id',
    tenantId: 'tenantId',
    sourceEventId: 'sourceEventId',
    sourceDocumentId: 'sourceDocumentId',
    sourceDocumentType: 'sourceDocumentType',
    entryType: 'entryType',
  },
}));

const ORIGINAL_ENTRY = {
  id: 501,
  gstinOfCounterparty: '27ABCDE1234F1Z5',
  counterpartyName: 'Acme Textiles',
  documentNumber: 'INV-2026-001',
  placeOfSupply: '27',
  isInterstate: false,
  taxableAmount: '10000',
  cgstAmount: '250',
  sgstAmount: '250',
  igstAmount: '0',
  cessAmount: '0',
  totalGst: '500',
  grandTotal: '10500',
  itcEligible: false,
  gstRate: '5.00',
  hsnCode: '6109',
  rcmApplicable: false,
  branchId: 3,
};

// First select() call = the original-entry lookup (orderBy/limit chain). Second select() call
// = insertEntry()'s own sourceEventId duplicate-check (plain awaited, no rows = not a dup).
function makeDb(originalRows: Record<string, unknown>[]) {
  let selectCallCount = 0;
  const insertValues = vi.fn();

  const db = {
    raw: {
      select: () => {
        selectCallCount += 1;
        const rows = selectCallCount === 1 ? originalRows : [];
        const limitResult = Promise.resolve(rows);
        const orderByResult = { limit: () => limitResult };
        const whereResult = Object.assign(Promise.resolve(rows), { orderBy: () => orderByResult });
        return { from: () => ({ where: () => whereResult }) };
      },
      insert: () => ({
        values: (v: unknown) => {
          insertValues(v);
          return { returning: () => Promise.resolve([{ id: 999 }]) };
        },
      }),
    },
  };

  return { db, insertValues };
}

describe('GstLedgerService.reverseSalesInvoiceEntry', () => {
  it("posts a negated offsetting entry copying the original entry's GST split and document number", async () => {
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    const { db, insertValues } = makeDb([ORIGINAL_ENTRY]);

    const result = await GstLedgerService.reverseSalesInvoiceEntry(
      db as never,
      1,
      42,
      'evt-cancel-1'
    );

    expect(result).toBe(999);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 1,
        entryType: 'SALES_INVOICE',
        documentNumber: 'INV-2026-001',
        isInterstate: false,
        taxableAmount: '-10000',
        cgstAmount: '-250',
        sgstAmount: '-250',
        igstAmount: '0',
        totalGst: '-500',
        grandTotal: '-10500',
        sourceEventId: 'evt-cancel-1',
        sourceDocumentId: 42,
        sourceDocumentType: 'INVOICE',
      })
    );
  });

  it('returns null and inserts nothing when no original SALES_INVOICE entry exists (e.g. invoice was cancelled while still DRAFT)', async () => {
    const { GstLedgerService } = await import('../domain/GstLedgerService.js');
    const { db, insertValues } = makeDb([]);

    const result = await GstLedgerService.reverseSalesInvoiceEntry(
      db as never,
      1,
      43,
      'evt-cancel-2'
    );

    expect(result).toBeNull();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
