/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { buildGateway } from '../app.js';
import { loadGatewayConfig } from '../config.js';
import { createLogger } from '@erp/logger';

const ENV_VAR_BY_SERVICE: Record<string, string> = {
  auth: 'AUTH_SERVICE_URL',
  tenant: 'TENANT_SERVICE_URL',
  inventory: 'INVENTORY_SERVICE_URL',
  sales: 'SALES_SERVICE_URL',
  notification: 'NOTIFICATION_SERVICE_URL',
  report: 'REPORT_SERVICE_URL',
  scheduler: 'SCHEDULER_SERVICE_URL',
  search: 'SEARCH_SERVICE_URL',
  gst: 'GST_SERVICE_URL',
  accounting: 'ACCOUNTING_SERVICE_URL',
  purchase: 'PURCHASE_SERVICE_URL',
  hr: 'HR_SERVICE_URL',
  production: 'PRODUCTION_SERVICE_URL',
  event: 'EVENT_SERVICE_URL',
};

// Fixes F3 (2026-07-23 API Gateway audit): proves the real wiring in app.ts — not just the
// standalone UpstreamCircuitBreaker unit tests — actually fast-fails once an upstream trips,
// and that a tripped breaker for one service doesn't affect a different, healthy one.
describe('API gateway — circuit breaker on the proxy path', () => {
  let gateway: FastifyInstance;
  let validToken: string;
  const healthyUpstreamApps: FastifyInstance[] = [];

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

    // 'sales' is deliberately left pointed at nothing listening (fast ECONNREFUSED, no real
    // timeout wait) to trip its breaker. Every other service gets a real, healthy local
    // upstream, to prove sales tripping doesn't affect them.
    for (const service of Object.keys(ENV_VAR_BY_SERVICE)) {
      if (service === 'sales') {
        process.env[ENV_VAR_BY_SERVICE[service]!] = 'http://127.0.0.1:1';
        continue;
      }
      const upstream = Fastify({ logger: false });
      upstream.get('/health', async () => ({ status: 'healthy' }));
      upstream.all('*', async () => ({ ok: true }));
      const address = await upstream.listen({ port: 0, host: '127.0.0.1' });
      process.env[ENV_VAR_BY_SERVICE[service]!] = address;
      healthyUpstreamApps.push(upstream);
    }

    const config = loadGatewayConfig();
    const logger = createLogger({ serviceName: 'api-gateway-test', level: 'error' });
    gateway = await buildGateway(config, logger);
    await gateway.ready();
  });

  afterAll(async () => {
    await gateway.close();
    await Promise.all(healthyUpstreamApps.map((app) => app.close()));
    for (const envVar of Object.values(ENV_VAR_BY_SERVICE)) delete process.env[envVar];
    delete process.env['JWT_PUBLIC_KEY'];
  });

  it('returns the real 502 for each of the first several failures, then fast-fails with a distinct 503 once the breaker trips', async () => {
    // FAILURE_THRESHOLD is 5 (upstream-circuit-breaker.ts) — the first 5 requests should
    // each genuinely attempt the proxy and get the real "unreachable" 502 from onError.
    for (let i = 0; i < 5; i++) {
      const response = await gateway.inject({
        method: 'GET',
        url: '/api/sales/ping',
        headers: { authorization: `Bearer ${validToken}` },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().error.message).toBe('sales-service is unreachable');
    }

    // The 6th request should be rejected by the breaker itself, before ever attempting the
    // proxy — distinguishable by its different message text (see app.ts's preHandler gate).
    const tripped = await gateway.inject({
      method: 'GET',
      url: '/api/sales/ping',
      headers: { authorization: `Bearer ${validToken}` },
    });
    expect(tripped.statusCode).toBe(503);
    expect(tripped.json().error.message).toContain('circuit open');
  });

  it('does not affect a different, healthy upstream', async () => {
    // sales's breaker is already tripped by the previous test (shared gateway instance,
    // matching this file's other test files' convention of one gateway for the whole suite).
    const response = await gateway.inject({
      method: 'GET',
      url: '/api/inventory/ping',
      headers: { authorization: `Bearer ${validToken}` },
    });
    expect(response.statusCode).toBe(200);
  });
});
