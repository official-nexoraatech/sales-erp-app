// Product audit 2026-07-31, Phase 1 Step 7 — POST /internal/financial-years/seed, the new
// internal-key-guarded route TenantProvisioner calls at provisioning time so a tenant's first
// Financial Year is no longer a manual go-live step.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../domain/FinancialYearService.js', () => ({
  FinancialYearService: { create: vi.fn() },
}));

const { schedulerInternalRoutes } = await import('../api/scheduler-internal.routes.js');
const { FinancialYearService } = await import('../domain/FinancialYearService.js');
const { financialYears } = await import('@erp/db');

function makeCtxFactory(existingFinancialYears: unknown[]) {
  const raw = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (table === financialYears ? existingFinancialYears : [])),
        })),
      })),
    })),
  };
  return {
    create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
      tenant,
      db: { raw },
    }),
  } as never;
}

describe('POST /internal/financial-years/seed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['INTERNAL_API_KEY'] = 'test-internal-key';
  });

  it('rejects a request with no x-internal-key header', async () => {
    const app = Fastify({ logger: false });
    await schedulerInternalRoutes(app, makeCtxFactory([]));
    const res = await app.inject({
      method: 'POST',
      url: '/internal/financial-years/seed?tenantId=5',
    });
    expect(res.statusCode).toBe(401);
    expect(FinancialYearService.create).not.toHaveBeenCalled();
  });

  it('rejects a request with no tenantId', async () => {
    const app = Fastify({ logger: false });
    await schedulerInternalRoutes(app, makeCtxFactory([]));
    const res = await app.inject({
      method: 'POST',
      url: '/internal/financial-years/seed',
      headers: { 'x-internal-key': 'test-internal-key' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates the FY containing today when the tenant has none yet, using the April–March convention', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T00:00:00Z')); // August -> FY started this calendar year
    vi.mocked(FinancialYearService.create).mockResolvedValue({
      id: 1,
      yearCode: 'FY2026-27',
    } as never);

    const app = Fastify({ logger: false });
    await schedulerInternalRoutes(app, makeCtxFactory([]));
    const res = await app.inject({
      method: 'POST',
      url: '/internal/financial-years/seed?tenantId=5',
      headers: { 'x-internal-key': 'test-internal-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.created).toBe(true);
    expect(FinancialYearService.create).toHaveBeenCalledWith(expect.anything(), 5, 0, {
      yearCode: 'FY2026-27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      isCurrent: true,
    });
    vi.useRealTimers();
  });

  it('computes the correct FY when today falls in Jan–March (previous calendar year start)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T00:00:00Z')); // February -> FY started last calendar year
    vi.mocked(FinancialYearService.create).mockResolvedValue({} as never);

    const app = Fastify({ logger: false });
    await schedulerInternalRoutes(app, makeCtxFactory([]));
    await app.inject({
      method: 'POST',
      url: '/internal/financial-years/seed?tenantId=5',
      headers: { 'x-internal-key': 'test-internal-key' },
    });

    expect(FinancialYearService.create).toHaveBeenCalledWith(expect.anything(), 5, 0, {
      yearCode: 'FY2025-26',
      startDate: '2025-04-01',
      endDate: '2026-03-31',
      isCurrent: true,
    });
    vi.useRealTimers();
  });

  it('is a no-op when the tenant already has a financial year', async () => {
    const app = Fastify({ logger: false });
    await schedulerInternalRoutes(app, makeCtxFactory([{ id: 99 }]));
    const res = await app.inject({
      method: 'POST',
      url: '/internal/financial-years/seed?tenantId=5',
      headers: { 'x-internal-key': 'test-internal-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.created).toBe(false);
    expect(FinancialYearService.create).not.toHaveBeenCalled();
  });
});
