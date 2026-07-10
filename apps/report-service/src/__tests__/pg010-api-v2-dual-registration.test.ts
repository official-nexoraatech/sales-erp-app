// PG-010: reportRoutes (PDF generation, number series) had no version prefix at all.
// main.ts now dual-registers it — once unprefixed (legacy, deprecation window) and once
// under /api/v2 (the new baseline convention) — so this asserts both paths are reachable.
// analyticsReportsRoutes/dashboardRoutes are NOT dual-registered here: they already
// hardcode /api/v2 (and /api/v1, for the aging reports) directly into their literal
// route paths, so wrapping them in an outer /api/v2 prefix too would double it.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { reportRoutes } from '../api/report.routes.js';
import { PdfEngine } from '../domain/PdfEngine.js';

describe('PG-010 — report-service dual /api/v2 + legacy registration', () => {
  it('reaches the same route both unprefixed and under /api/v2', async () => {
    const app = Fastify({ logger: false });
    const db = {} as ErpDatabase;
    const pdfEngine = new PdfEngine();

    await reportRoutes(app, db, pdfEngine);
    await app.register(async (sub) => {
      await reportRoutes(sub, db, pdfEngine);
    }, { prefix: '/api/v2' });

    const legacy = await app.inject({ method: 'POST', url: '/reports/pdf', payload: {} });
    const v2 = await app.inject({ method: 'POST', url: '/api/v2/reports/pdf', payload: {} });

    expect(legacy.statusCode).not.toBe(404);
    expect(v2.statusCode).not.toBe(404);
    expect(legacy.statusCode).toBe(v2.statusCode);

    await app.close();
  });
});
