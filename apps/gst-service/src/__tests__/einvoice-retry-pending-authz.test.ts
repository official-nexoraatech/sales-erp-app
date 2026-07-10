// ES-33 — /gst/einvoice/retry-pending had zero auth enforcement. The `config: {
// internalOnly: true }` flag it carried was dead metadata (never read anywhere in the
// codebase), so any caller — inside or outside the tenant — could trigger a cross-tenant
// IRN retry sweep. Fixed by wiring the same requireInternalKey() timing-safe check used
// by every other internal/scheduler-triggered endpoint in this codebase.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { einvoiceRoutes } from '../api/einvoice.routes.js';

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (
    request: { headers: { authorization?: string }; auth?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    request.auth = JSON.parse(authHeader.slice(7)) as unknown;
  },
}));

vi.mock('../middleware/authorize.js', () => ({
  requirePermission: () => async (): Promise<void> => {},
}));

vi.mock('../domain/EInvoiceService.js', () => ({
  EInvoiceService: {
    retryPendingIrns: vi.fn().mockResolvedValue({ retried: 3, failed: 0 }),
  },
}));

describe('ES-33 — POST /gst/einvoice/retry-pending internal-key enforcement', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = 'test-internal-key';
  });

  afterEach(() => {
    delete process.env['INTERNAL_API_KEY'];
  });

  it('rejects requests with no x-internal-key header with 401', async () => {
    const app = Fastify({ logger: false });
    await einvoiceRoutes(app, {} as PlatformContextFactory);

    const res = await app.inject({ method: 'POST', url: '/gst/einvoice/retry-pending' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects requests with a wrong x-internal-key with 401', async () => {
    const app = Fastify({ logger: false });
    await einvoiceRoutes(app, {} as PlatformContextFactory);

    const res = await app.inject({
      method: 'POST',
      url: '/gst/einvoice/retry-pending',
      headers: { 'x-internal-key': 'wrong-key' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts requests with the correct x-internal-key and runs the retry sweep', async () => {
    const app = Fastify({ logger: false });
    await einvoiceRoutes(app, {} as PlatformContextFactory);

    const res = await app.inject({
      method: 'POST',
      url: '/gst/einvoice/retry-pending',
      headers: { 'x-internal-key': 'test-internal-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: { retried: 3, failed: 0 } });
    await app.close();
  });
});
