/* global process */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { gatewayAuthPreHandler } from '../middleware/gateway-auth.js';

describe('gatewayAuthPreHandler', () => {
  let app: FastifyInstance;
  let publicKeyPem: string;
  let privateKeyPem: string;

  beforeEach(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    publicKeyPem = await exportSPKI(publicKey);
    privateKeyPem = await exportPKCS8(privateKey);
    process.env['JWT_PUBLIC_KEY'] = publicKeyPem;

    app = Fastify({ logger: false });
    app.addHook('preHandler', gatewayAuthPreHandler);
    app.get('/health', async () => ({ ok: true }));
    app.get('/api/sales/api/v2/invoices', async (request) => ({
      tenantHeader: request.headers['x-tenant-id'],
    }));
    app.post('/api/auth/auth/forgot-password', async () => ({ ok: true }));
    app.post('/api/auth/auth/reset-password', async () => ({ ok: true }));
    app.post('/api/auth/auth/mfa/verify', async () => ({ ok: true }));
    app.post('/api/auth/auth/logout', async () => ({ ok: true }));
    app.get('/api/report/unsubscribe/some-token-123', async () => ({ ok: true }));
    app.get('/api/notification/notifications/stream', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    delete process.env['JWT_PUBLIC_KEY'];
    await app.close();
  });

  async function signToken(claims: Record<string, unknown>, expiresIn = '1h'): Promise<string> {
    const privateKey = await importPKCS8(privateKeyPem, 'RS256');
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(String(claims['sub'] ?? '1'))
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  it('allows /health through without an Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('returns 401 when Authorization header is missing on a non-exempt path', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sales/api/v2/invoices' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) },
    });
  });

  it('returns 401 for a malformed Authorization header (no Bearer prefix)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: 'Token abc123' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = await signToken({ sub: '1', tenantId: 1 }, '-10s');
    const response = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for a token signed with a different key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: '1', tenantId: 1 })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(otherKey);
    const response = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it.each([
    '/api/auth/auth/forgot-password',
    '/api/auth/auth/reset-password',
    '/api/auth/auth/mfa/verify',
    '/api/auth/auth/logout',
  ])('allows %s through without an Authorization header', async (url) => {
    const response = await app.inject({ method: 'POST', url });
    expect(response.statusCode).toBe(200);
  });

  it('allows a dynamic-token unsubscribe link through via prefix match, without an Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/report/unsubscribe/some-token-123',
    });
    expect(response.statusCode).toBe(200);
  });

  it('allows a request through with a valid token and does not inject an x-tenant-id header', async () => {
    const token = await signToken({ sub: '42', tenantId: 7 });
    const response = await app.inject({
      method: 'GET',
      url: '/api/sales/api/v2/invoices',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    // Deliberately not propagated — see gateway-auth.ts's header comment. Downstream
    // services re-derive tenantId from the JWT itself, not from a gateway-set header.
    expect(response.json()).toEqual({ tenantHeader: undefined });
  });

  // Regression test for a live-QA finding (2026-07-17): the SSE stream 401'd on every page
  // load because the gateway only recognized an Authorization header, but the browser's
  // native EventSource API can't set one — the frontend passes the JWT as ?token= instead
  // (notification-service's own authenticateStream already handled this; the gateway didn't).
  it('accepts a ?token= query param for the notification SSE stream route', async () => {
    const token = await signToken({ sub: '42', tenantId: 7 });
    const response = await app.inject({
      method: 'GET',
      url: `/api/notification/notifications/stream?token=${token}`,
    });
    expect(response.statusCode).toBe(200);
  });

  it('still returns 401 for the SSE stream route with no token at all', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/notification/notifications/stream',
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not accept a ?token= query param on a non-SSE route (query-token fallback is route-scoped)', async () => {
    const token = await signToken({ sub: '42', tenantId: 7 });
    const response = await app.inject({
      method: 'GET',
      url: `/api/sales/api/v2/invoices?token=${token}`,
    });
    expect(response.statusCode).toBe(401);
  });
});
