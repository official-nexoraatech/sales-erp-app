// PG-009 — POST /exports/generate previously faked instant success (status: 'READY' with a
// placeholder signedUrl, no real file ever generated) and GET /download returned two lines of
// placeholder text. This suite locks in the real async pipeline: generate enqueues real work
// and returns PENDING/GENERATING, PDF requests for bulk entity export are rejected, and
// download only ever redirects to a real signed URL once the job is READY.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { ErpDatabase } from '@erp/db';
import type { JobRegistry } from '../JobRegistry.js';
import { exportRoutes } from '../api/export.routes.js';
import { EXPORT_GENERATE_JOB } from '../jobs/exportGenerateJob.js';

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (
    request: { headers: { authorization?: string }; auth?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } });
      return;
    }
    request.auth = JSON.parse(authHeader.slice(7)) as unknown;
  },
}));

function authHeader(auth: { tenantId: number; permissions: string[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, ...auth })}`,
  };
}

function makeFakeDb(opts: {
  insertReturn?: { id: number; entityType: string; format: string };
  selectRows?: unknown[];
}) {
  const updateSets: Array<Record<string, unknown>> = [];
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(opts.insertReturn ? [opts.insertReturn] : []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        updateSets.push(patch);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(opts.selectRows ?? []),
        })),
      })),
    })),
    updateSets,
  };
}

function makeFakeRegistry() {
  return { triggerManual: vi.fn().mockResolvedValue('bull-job-1') };
}

describe('POST /exports/generate', () => {
  it('rejects PDF format with 400 FORMAT_NOT_SUPPORTED instead of faking success', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({});
    const registry = makeFakeRegistry();
    await exportRoutes(app, db as unknown as ErpDatabase, registry as unknown as JobRegistry);

    const res = await app.inject({
      method: 'POST',
      url: '/exports/generate',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_GENERATE'] }),
      payload: { entityType: 'customer', format: 'PDF' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'FORMAT_NOT_SUPPORTED' } });
    expect(db.insert).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 201 with GENERATING (not instant READY) and enqueues the real export job', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({ insertReturn: { id: 42, entityType: 'customer', format: 'CSV' } });
    const registry = makeFakeRegistry();
    await exportRoutes(app, db as unknown as ErpDatabase, registry as unknown as JobRegistry);

    const res = await app.inject({
      method: 'POST',
      url: '/exports/generate',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_GENERATE'] }),
      payload: { entityType: 'customer', format: 'CSV' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { jobId: number; downloadUrl: string } };
    expect(body.data.jobId).toBe(42);
    expect(body.data.downloadUrl).not.toContain('placeholder');

    expect(db.updateSets).toContainEqual(expect.objectContaining({ status: 'GENERATING' }));
    expect(registry.triggerManual).toHaveBeenCalledWith(
      EXPORT_GENERATE_JOB,
      1,
      expect.objectContaining({ jobId: 42, entityType: 'customer', format: 'CSV' })
    );
    await app.close();
  });
});

describe('GET /exports/:jobId/download', () => {
  it('returns 202 when the job is not READY yet', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({ selectRows: [{ id: 1, status: 'GENERATING' }] });
    await exportRoutes(app, db as unknown as ErpDatabase, makeFakeRegistry() as unknown as JobRegistry);

    const res = await app.inject({
      method: 'GET',
      url: '/exports/1/download',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_VIEW'] }),
    });

    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it('redirects to the real signed URL once the job is READY (no placeholder fallback)', async () => {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({
      selectRows: [{ id: 1, status: 'READY', signedUrl: 'https://minio.local/tenant/1/exports/customer.csv', signedUrlExpiresAt: null }],
    });
    await exportRoutes(app, db as unknown as ErpDatabase, makeFakeRegistry() as unknown as JobRegistry);

    const res = await app.inject({
      method: 'GET',
      url: '/exports/1/download',
      headers: authHeader({ tenantId: 1, permissions: ['EXPORT_VIEW'] }),
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://minio.local/tenant/1/exports/customer.csv');
    await app.close();
  });
});
