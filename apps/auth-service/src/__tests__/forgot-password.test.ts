/**
 * PG-017 — Password Reset Email Delivery
 *
 * Covers:
 *   - an existing, active user triggers a fire-and-forget call to notification-service's
 *     send-internal endpoint with the correct payload (tenantId, eventType, resetLink)
 *   - a non-existent email still returns 200 (enumeration protection) and triggers neither
 *     a token insert nor a notification-service call
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('@erp/db', () => ({
  users: {},
  passwordResetTokens: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
}));

import { forgotPasswordRoute } from '../routes/forgot-password.js';

const TEST_CONFIG = {
  passwordResetTokenTtlMs: 3_600_000,
  frontendUrl: 'https://app.testco.com',
  nodeEnv: 'test',
};

function makeSelectLimit(rows: unknown[]): unknown {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

async function buildApp(db: Record<string, unknown>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await forgotPasswordRoute(app, db as never, TEST_CONFIG as never);
  return app;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PG-017 — forgot-password email delivery', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('triggers notification-service send-internal for an existing active user', async () => {
    const mockUser = { id: 1, email: 'user@testco.com', tenantId: 1, isActive: true };
    const insertValues = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue(makeSelectLimit([mockUser])),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };

    const app = await buildApp(db);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'user@testco.com', tenantId: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, tenantId: 1 }));

    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('/notifications/send-internal');

    const payload = JSON.parse(opts.body) as {
      tenantId: number;
      eventType: string;
      recipientUserId: number;
      recipientEmail: string;
      channels: string[];
      templateData: { resetLink: string };
    };
    expect(payload).toMatchObject({
      tenantId: 1,
      eventType: 'PASSWORD_RESET_REQUESTED',
      recipientUserId: 1,
      recipientEmail: 'user@testco.com',
      channels: ['EMAIL'],
    });
    expect(payload.templateData.resetLink).toMatch(/^https:\/\/app\.testco\.com\/reset-password\?token=[0-9a-f]{64}$/);

    await app.close();
  });

  it('returns 200 for a non-existent email without inserting a token or calling notification-service', async () => {
    const db = {
      select: vi.fn().mockReturnValue(makeSelectLimit([])),
      insert: vi.fn(),
    };

    const app = await buildApp(db);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nobody@testco.com', tenantId: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toMatch(/if this email exists/i);
    expect(db.insert).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();

    await app.close();
  });
});
