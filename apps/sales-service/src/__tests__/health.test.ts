/**
 * ES-16 — GET /health dependency-check contract (buildHealthResponse in
 * packages/platform-sdk/src/health.ts, wired into every service via
 * registerHealthRoute).
 */
import { describe, it, expect } from 'vitest';
import { buildHealthResponse } from '@erp/sdk';

describe('buildHealthResponse — ES-16', () => {
  it('returns 200 healthy when every dependency check passes', async () => {
    const { statusCode, body } = await buildHealthResponse('sales-service', {
      db: async () => true,
      redis: async () => true,
    });

    expect(statusCode).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks).toEqual({ db: true, redis: true });
    expect(body.service).toBe('sales-service');
  });

  it('returns 503 degraded when the db check fails', async () => {
    const { statusCode, body } = await buildHealthResponse('sales-service', {
      db: async () => false,
      redis: async () => true,
    });

    expect(statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks).toEqual({ db: false, redis: true });
  });
});
