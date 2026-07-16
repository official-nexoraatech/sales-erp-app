/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { createLogger } from '@erp/logger';
import { buildGateway } from '../app.js';
import { loadGatewayConfig, type UpstreamConfig } from '../config.js';

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

describe('API gateway — routing', () => {
  let gateway: FastifyInstance;
  const upstreamApps: FastifyInstance[] = [];
  let upstreamHitCounts: Record<string, number>;
  let validToken: string;
  let upstreams: UpstreamConfig[];

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    process.env['JWT_PUBLIC_KEY'] = await exportSPKI(publicKey);
    const privateKeyPem = await exportPKCS8(privateKey);
    const signingKey = await importPKCS8(privateKeyPem, 'RS256');
    validToken = await new SignJWT({ sub: '1', tenantId: 1 })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setExpirationTime('1h')
      .sign(signingKey);

    upstreamHitCounts = Object.fromEntries(Object.keys(ENV_VAR_BY_SERVICE).map((s) => [s, 0]));

    // One lightweight local Fastify instance per upstream, standing in for each real
    // backend service — verifies the gateway forwards to the correct target rather
    // than mocking at the network layer.
    for (const service of Object.keys(ENV_VAR_BY_SERVICE)) {
      const upstream = Fastify({ logger: false });
      upstream.get('/health', async () => ({ status: 'healthy' }));
      upstream.all('*', async (request) => {
        upstreamHitCounts[service] += 1;
        return { service, path: request.url };
      });
      const address = await upstream.listen({ port: 0, host: '127.0.0.1' });
      process.env[ENV_VAR_BY_SERVICE[service]!] = address;
      upstreamApps.push(upstream);
    }

    const config = loadGatewayConfig();
    upstreams = config.upstreams;
    const logger = createLogger({ serviceName: 'api-gateway-test', level: 'error' });
    gateway = await buildGateway(config, logger);
    await gateway.ready();
  });

  afterAll(async () => {
    await gateway.close();
    await Promise.all(upstreamApps.map((app) => app.close()));
    for (const envVar of Object.values(ENV_VAR_BY_SERVICE)) delete process.env[envVar];
    delete process.env['JWT_PUBLIC_KEY'];
  });

  it.each(Object.keys(ENV_VAR_BY_SERVICE))(
    'proxies /api/%s to the correct upstream',
    async (service) => {
      const upstream = upstreams.find((u) => u.service === service)!;
      const response = await gateway.inject({
        method: 'GET',
        url: `${upstream.prefix}/ping`,
        headers: { authorization: `Bearer ${validToken}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.service).toBe(service);
      expect(body.path).toBe(`${upstream.rewritePrefix}/ping`);
    }
  );

  it('aggregates all upstream statuses on /health', async () => {
    const response = await gateway.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('healthy');
    for (const service of Object.keys(ENV_VAR_BY_SERVICE)) {
      expect(body.checks[service]).toBe(true);
    }
  });

  it('returns 401 for a non-exempt path with no Authorization header, without reaching the upstream', async () => {
    const before = upstreamHitCounts['sales'];
    const response = await gateway.inject({ method: 'GET', url: '/api/sales/api/v2/invoices' });
    expect(response.statusCode).toBe(401);
    expect(upstreamHitCounts['sales']).toBe(before);
  });
});
