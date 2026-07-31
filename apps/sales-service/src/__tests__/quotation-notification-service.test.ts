// H-9 fix: "Send" on a quotation previously only flipped quotations.status to SENT — nothing
// was ever actually transmitted to the customer. Mirrors the existing (untested-but-proven)
// InvoiceNotificationService pattern: best-effort, non-blocking, never throws.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
}));

vi.mock('@erp/db', () => ({
  quotations: { id: 'id', tenantId: 'tenant_id' },
  customers: { id: 'id', tenantId: 'tenant_id' },
}));

import { QuotationNotificationService } from '../domain/QuotationNotificationService.js';

const QUOTATION_ROW = {
  quotationNumber: 'QT-1-100',
  grandTotal: '5000',
  validUntil: new Date('2026-12-31'),
  customerId: 42,
};

function makeCtx(customerRow: Record<string, unknown> | undefined) {
  let selectCallCount = 0;
  return {
    tenant: { tenantId: 1 },
    db: {
      raw: {
        select: () => {
          selectCallCount += 1;
          const row = selectCallCount === 1 ? QUOTATION_ROW : customerRow;
          return { from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) };
        },
      },
    },
  } as never;
}

describe('QuotationNotificationService.notifyQuotationSent', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends WHATSAPP and EMAIL when the customer has both and opted into neither out', async () => {
    await QuotationNotificationService.notifyQuotationSent(
      makeCtx({
        displayName: 'Test Co',
        phone: '9990001111',
        email: 'test@co.com',
        optOutWhatsapp: false,
        optOutEmail: false,
      }),
      1
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const channels = fetchMock.mock.calls.map(
      ([, opts]) => (JSON.parse((opts as { body: string }).body) as { channel: string }).channel
    );
    expect(channels.sort()).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('sends nothing when the customer opted out of both channels', async () => {
    await QuotationNotificationService.notifyQuotationSent(
      makeCtx({
        displayName: 'Test Co',
        phone: '9990001111',
        email: 'test@co.com',
        optOutWhatsapp: true,
        optOutEmail: true,
      }),
      1
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when the customer is not found', async () => {
    await expect(
      QuotationNotificationService.notifyQuotationSent(makeCtx(undefined), 1)
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
