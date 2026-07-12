// QA session (2026-07-12) -- /auth/forgot-password had no dedicated rate limit, only the
// generic global 200/min default that applies to every route in this service. Unlike /auth/login
// (a stricter 10/15min override), an endpoint that triggers an email send and is a classic
// enumeration/harassment target had no endpoint-specific throttle. Added
// FORGOT_PASSWORD_RATE_LIMIT_MAX/WINDOW_MS (default 5/15min, matching login's shape) mirroring
// the existing per-route config.rateLimit pattern in login.ts.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { forgotPasswordRoute } from '../routes/forgot-password.js';

vi.mock('@erp/db', () => ({ users: {}, passwordResetTokens: {} }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isNull__'),
}));

describe('POST /auth/forgot-password rate limiting', () => {
  it('429s once the per-route limit is exceeded, before the generic global default would kick in', async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimit, { global: false });

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    } as never;

    await forgotPasswordRoute(app, mockDb, {
      forgotPasswordRateLimitMax: 2,
      forgotPasswordRateLimitWindowMs: 900000,
      frontendUrl: 'http://localhost:3000',
      nodeEnv: 'test',
    } as never);

    const payload = { email: 'someone@example.com', tenantId: 1 };
    const res1 = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload });
    const res2 = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload });
    const res3 = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res3.statusCode).toBe(429);

    await app.close();
  });
});
