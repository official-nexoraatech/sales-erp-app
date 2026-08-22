// H-9 fix: payment creation previously only enqueued a tenant-configured outbound webhook
// (WebhookService — a third-party integration mechanism) with no customer-facing
// acknowledgment at all. Mirrors the existing InvoiceNotificationService pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
}));

vi.mock('@erp/db', () => ({
  payments: { id: 'id', tenantId: 'tenant_id' },
  customers: { id: 'id', tenantId: 'tenant_id' },
}));

// RLS-readiness follow-up (2026-08-22): notifyPaymentReceived now manages its own
// withTenantConnection wrap (same signature change as InvoiceNotificationService.
// notifyInvoiceConfirmed) instead of taking a caller-supplied ctx. This is a unit test of the
// service in isolation, so withTenantConnection is mocked to just invoke the callback directly
// with the raw db stand-in — no real transaction/GUC machinery needed here.
vi.mock('@erp/sdk', () => ({
  withTenantConnection: (rawDb: unknown, _tenantId: number, fn: (db: unknown) => unknown) =>
    fn(rawDb),
}));

import { PaymentNotificationService } from '../domain/PaymentNotificationService.js';

const PAYMENT_ROW = {
  paymentNumber: 'PAY-1-100',
  amount: '2500',
  paymentMode: 'UPI',
  customerId: 42,
};

function makeRawDb(customerRow: Record<string, unknown> | undefined) {
  let selectCallCount = 0;
  return {
    select: () => {
      selectCallCount += 1;
      const row = selectCallCount === 1 ? PAYMENT_ROW : customerRow;
      return { from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) };
    },
  } as never;
}

describe('PaymentNotificationService.notifyPaymentReceived', () => {
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
    await PaymentNotificationService.notifyPaymentReceived(
      makeRawDb({
        displayName: 'Test Co',
        phone: '9990001111',
        email: 'test@co.com',
        optOutWhatsapp: false,
        optOutEmail: false,
      }),
      1,
      1
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const channels = fetchMock.mock.calls.map(
      ([, opts]) => (JSON.parse((opts as { body: string }).body) as { channel: string }).channel
    );
    expect(channels.sort()).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('sends only EMAIL when the customer opted out of WhatsApp', async () => {
    await PaymentNotificationService.notifyPaymentReceived(
      makeRawDb({
        displayName: 'Test Co',
        phone: '9990001111',
        email: 'test@co.com',
        optOutWhatsapp: true,
        optOutEmail: false,
      }),
      1,
      1
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0]!;
    expect((JSON.parse((opts as { body: string }).body) as { channel: string }).channel).toBe(
      'EMAIL'
    );
  });

  it('does not throw when the payment is not found', async () => {
    const rawDb = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as never;

    await expect(
      PaymentNotificationService.notifyPaymentReceived(rawDb, 1, 1)
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
