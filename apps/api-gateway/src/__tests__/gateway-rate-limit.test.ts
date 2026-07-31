/* global process */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { tenantOrIpKeyGenerator } from '@erp/sdk';
import { gatewayAuthDecorate, gatewayAuthReject } from '../middleware/gateway-auth.js';

// Regression coverage for F1 (2026-07-23 API Gateway audit): tenantOrIpKeyGenerator was
// already wired up in app.ts but silently always fell back to IP-keying, because
// request.auth didn't exist yet at rate-limit time. Fixed by reordering: decorate (verify +
// attach request.auth) -> rate-limit (preHandler-phase, so it can see request.auth) ->
// reject. This file proves the reordering actually produces per-tenant isolation, using a
// standalone minimal app (mirrors gateway-auth.test.ts's convention) with a low `max` rather
// than overriding the shared production RATE_LIMIT_DEFAULTS.
describe('gateway rate limiting — tenant isolation', () => {
  let app: FastifyInstance;
  let privateKeyPem: string;

  beforeEach(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    process.env['JWT_PUBLIC_KEY'] = await exportSPKI(publicKey);
    privateKeyPem = await exportPKCS8(privateKey);

    app = Fastify({ logger: false });
    // global: false + app.rateLimit() — see app.ts's comment on why `global: true` can't be
    // interleaved between decorate and reject via hook-phase alone.
    await app.register(rateLimit, {
      global: false,
      max: 1,
      timeWindow: '1 minute',
      keyGenerator: tenantOrIpKeyGenerator,
    });
    app.addHook('preHandler', gatewayAuthDecorate);
    app.addHook('preHandler', app.rateLimit());
    app.addHook('preHandler', gatewayAuthReject);
    app.get('/api/sales/api/v2/invoices', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    delete process.env['JWT_PUBLIC_KEY'];
    await app.close();
  });

  async function signToken(tenantId: number): Promise<string> {
    const privateKey = await importPKCS8(privateKeyPem, 'RS256');
    return new SignJWT({ sub: '1', tenantId })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer('erp-auth-service')
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('does not share a rate-limit bucket between two different tenants on the same IP', async () => {
    const tokenA = await signToken(1);
    const tokenB = await signToken(2);

    const first = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const second = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // Both requests come from the same inject "IP" (127.0.0.1) but carry different
    // tenants — with max:1, an IP-keyed limiter would 429 the second request. It doesn't.
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it('does enforce the limit within a single tenant', async () => {
    const token = await signToken(1);

    const first = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });

  it('still rate-limits by IP when no valid token is present, rather than skipping the limiter', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/sales/api/v2/invoices' });
    const second = await app.inject({ method: 'GET', url: '/api/sales/api/v2/invoices' });

    // Both are unauthenticated, so both would 401 from gatewayAuthReject on their own — but
    // the rate limiter runs first and the second request should be capped (429) rather than
    // reaching the reject stage, proving an invalid/missing-token flood is still counted
    // against a shared IP bucket and not exempted from rate-limiting entirely.
    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(429);
  });

  it('rejects a forged token with an arbitrary tenantId claim from ever counting against that tenant (unverifiable tokens fall back to IP)', async () => {
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: '1', tenantId: 999 })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('erp-auth-service')
      .setExpirationTime('1h')
      .sign(otherKey);

    const legit = await signToken(999);

    // The forged token (wrong signing key) must not be able to pre-emptively consume
    // tenant 999's real quota — it should fail verification and fall back to IP-keying, so
    // the legitimately-signed request for the same tenantId still succeeds afterward.
    const forgedAttempt = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${forged}` },
    });
    const legitAttempt = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${legit}` },
    });

    expect(forgedAttempt.statusCode).toBe(401);
    expect(legitAttempt.statusCode).toBe(200);
  });
});
