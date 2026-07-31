/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { buildGateway } from '../app.js';
import { loadGatewayConfig } from '../config.js';
import { createLogger } from '@erp/logger';

// Fixes F8 (2026-07-23 API Gateway audit): @fastify/http-proxy streams request bodies
// straight through without going through Fastify's own bodyLimit-enforcing parser, so a
// payload of any size previously passed through this gateway completely unbounded (confirmed
// empirically with a 30MB payload before this fix). This proves the new onRequest gate
// actually rejects an oversized body before it ever reaches the upstream.
describe('API gateway — proxied request body size limit', () => {
  let gateway: FastifyInstance;
  let upstream: FastifyInstance;
  let upstreamHits: number;
  let validToken: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    process.env['JWT_PUBLIC_KEY'] = await exportSPKI(publicKey);
    const signingKey = await importPKCS8(await exportPKCS8(privateKey), 'RS256');
    validToken = await new SignJWT({ sub: '1', tenantId: 1 })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer('erp-auth-service')
      .setExpirationTime('1h')
      .sign(signingKey);

    upstreamHits = 0;
    upstream = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
    upstream.get('/health', async () => ({ status: 'healthy' }));
    upstream.post('/api/v2/echo', async () => {
      upstreamHits += 1;
      return { ok: true };
    });
    const address = await upstream.listen({ port: 0, host: '127.0.0.1' });
    process.env['SALES_SERVICE_URL'] = address;

    for (const [envVar] of [
      ['AUTH_SERVICE_URL'],
      ['TENANT_SERVICE_URL'],
      ['INVENTORY_SERVICE_URL'],
      ['NOTIFICATION_SERVICE_URL'],
      ['REPORT_SERVICE_URL'],
      ['SCHEDULER_SERVICE_URL'],
      ['SEARCH_SERVICE_URL'],
      ['GST_SERVICE_URL'],
      ['ACCOUNTING_SERVICE_URL'],
      ['PURCHASE_SERVICE_URL'],
      ['HR_SERVICE_URL'],
      ['PRODUCTION_SERVICE_URL'],
      ['EVENT_SERVICE_URL'],
    ]) {
      process.env[envVar!] = 'http://127.0.0.1:1';
    }

    const config = loadGatewayConfig();
    const logger = createLogger({ serviceName: 'api-gateway-test', level: 'error' });
    gateway = await buildGateway(config, logger);
    await gateway.ready();
  });

  afterAll(async () => {
    await gateway.close();
    await upstream.close();
    delete process.env['JWT_PUBLIC_KEY'];
    for (const envVar of [
      'AUTH_SERVICE_URL',
      'TENANT_SERVICE_URL',
      'INVENTORY_SERVICE_URL',
      'SALES_SERVICE_URL',
      'NOTIFICATION_SERVICE_URL',
      'REPORT_SERVICE_URL',
      'SCHEDULER_SERVICE_URL',
      'SEARCH_SERVICE_URL',
      'GST_SERVICE_URL',
      'ACCOUNTING_SERVICE_URL',
      'PURCHASE_SERVICE_URL',
      'HR_SERVICE_URL',
      'PRODUCTION_SERVICE_URL',
      'EVENT_SERVICE_URL',
    ]) {
      delete process.env[envVar];
    }
  });

  it('allows a normal, small payload through to the upstream', async () => {
    const response = await gateway.inject({
      method: 'POST',
      url: '/api/sales/echo',
      headers: { authorization: `Bearer ${validToken}`, 'content-type': 'application/json' },
      payload: { hello: 'world' },
    });
    expect(response.statusCode).toBe(200);
    expect(upstreamHits).toBe(1);
  });

  it('rejects a request whose declared Content-Length exceeds the limit, before reaching the upstream', async () => {
    const before = upstreamHits;
    const bigPayload = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }); // ~2MB
    const response = await gateway.inject({
      method: 'POST',
      url: '/api/sales/echo',
      headers: { authorization: `Bearer ${validToken}`, 'content-type': 'application/json' },
      payload: bigPayload,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) },
    });
    expect(upstreamHits).toBe(before); // never reached the upstream
  });
});
