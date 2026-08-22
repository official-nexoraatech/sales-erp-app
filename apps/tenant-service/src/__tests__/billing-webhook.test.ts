// PG-027 Session 2 — billing webhook signature verification. Mocks @erp/db (this file's route
// only touches tenantInvoices) and drizzle-orm's `eq`, mirroring the existing minimal-mock
// convention already used by billing-service.test.ts (see [[erp_db_vitest_barrel_export_bug]]).
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';

vi.mock('@erp/db', () => ({
  tenantInvoices: { __name: 'tenant_invoices', paymentGatewayRef: 'payment_gateway_ref' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  // withTenantConnection (used by this route to scope the update once the tenant is
  // resolved via the paymentGatewayRef lookup) uses drizzle-orm's own sql tagged template
  // internally — a per-file vi.mock('drizzle-orm', ...) replaces the module for every
  // importer, so it must be included here too or the SET LOCAL call throws.
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

vi.mock('@erp/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { billingWebhookRoutes } from '../api/billing-webhook.routes.js';

const WEBHOOK_SECRET = 'test_webhook_secret';

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
}

async function makeApp(): Promise<ReturnType<typeof Fastify>> {
  process.env['RAZORPAY_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
  const app = Fastify();
  const fakeDb: Record<string, unknown> = {
    select: () => ({ from: () => ({ where: async () => [{ tenantId: 2 }] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    execute: () => Promise.resolve(),
  };
  fakeDb['transaction'] = (cb: (trx: typeof fakeDb) => unknown) => cb(fakeDb);
  await billingWebhookRoutes(app, fakeDb as never);
  await app.ready();
  return app;
}

describe('POST /billing/webhooks/razorpay', () => {
  it('rejects a request with a missing signature header', async () => {
    const app = await makeApp();
    const payload = JSON.stringify({ event: 'payment.captured', payload: {} });
    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/razorpay',
      payload,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a request with an invalid signature', async () => {
    const app = await makeApp();
    const payload = JSON.stringify({ event: 'payment.captured', payload: {} });
    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/razorpay',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': 'not-the-right-signature',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a request with a valid signature', async () => {
    const app = await makeApp();
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_123', order_id: 'order_123', status: 'captured' } },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/razorpay',
      payload,
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(payload) },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: { received: true } });
  });

  it('acknowledges an unhandled event type without erroring, once signature verifies', async () => {
    const app = await makeApp();
    const payload = JSON.stringify({ event: 'order.paid', payload: {} });
    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/razorpay',
      payload,
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(payload) },
    });
    expect(res.statusCode).toBe(200);
  });
});
