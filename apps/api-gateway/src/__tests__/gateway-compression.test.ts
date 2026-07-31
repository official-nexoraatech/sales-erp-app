/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { buildGateway } from '../app.js';
import { loadGatewayConfig } from '../config.js';
import { createLogger } from '@erp/logger';

// Fixes F5 (2026-07-23 API Gateway audit): no service in this codebase compresses its own
// responses. Proves the gateway now compresses a proxied response when the client's
// Accept-Encoding allows it, and leaves it uncompressed when the client doesn't ask for it.
describe('API gateway — response compression', () => {
  let gateway: FastifyInstance;
  let upstream: FastifyInstance;
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

    upstream = Fastify({ logger: false });
    upstream.get('/health', async () => ({ status: 'healthy' }));
    // A large-ish, compressible JSON body — small/trivial responses can legitimately end up
    // NOT compressed even when Accept-Encoding is sent (not worth the CPU for a few bytes);
    // this needs to be big enough that the plugin's own default threshold compresses it.
    upstream.get('/api/v2/big-list', async () => ({
      items: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `item-${i}`.repeat(3) })),
    }));
    const address = await upstream.listen({ port: 0, host: '127.0.0.1' });
    process.env['SALES_SERVICE_URL'] = address;

    for (const envVar of [
      'AUTH_SERVICE_URL',
      'TENANT_SERVICE_URL',
      'INVENTORY_SERVICE_URL',
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
      process.env[envVar] = 'http://127.0.0.1:1';
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

  it('compresses a proxied response when the client accepts gzip', async () => {
    const response = await gateway.inject({
      method: 'GET',
      url: '/api/sales/big-list',
      headers: { authorization: `Bearer ${validToken}`, 'accept-encoding': 'gzip' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('leaves the response uncompressed when the client sends no Accept-Encoding', async () => {
    const response = await gateway.inject({
      method: 'GET',
      url: '/api/sales/big-list',
      headers: { authorization: `Bearer ${validToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
  });
});
