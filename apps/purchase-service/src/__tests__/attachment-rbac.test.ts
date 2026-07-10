// Attachment RBAC by parent-record type — before this fix, every route in
// attachment.routes.ts (upload/list/download/delete) was gated uniformly on PO_UPDATE/PO_VIEW
// regardless of whether the attachment belonged to a PURCHASE_ORDER or a GRN: a GRN_VIEW/
// GRN_CREATE holder without PO permissions couldn't manage their own GRN attachments at all,
// and a PO_VIEW/PO_UPDATE holder could manage GRN attachments without any GRN permission.
// This verifies the fix: PURCHASE_ORDER attachments require PO_VIEW/PO_UPDATE, GRN attachments
// require GRN_VIEW/GRN_UPDATE, decided per-request (upload/list) or per-row (download/delete,
// since entityType is only known once the attachment row itself is looked up).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type * as ErpTypes from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { attachmentRoutes } from '../api/attachment.routes.js';

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (
    request: { headers: { authorization?: string }; auth?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    request.auth = JSON.parse(authHeader.slice(7)) as unknown;
  },
}));

vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      PO_VIEW: 'PO_VIEW',
      PO_UPDATE: 'PO_UPDATE',
      GRN_VIEW: 'GRN_VIEW',
      GRN_UPDATE: 'GRN_UPDATE',
    },
  };
});

function authHeader(permissions: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({ sub: '1', userId: 1, tenantId: 1, email: 't@test.com', roles: [], branchIds: [], permissions })}`,
  };
}

const getMock = vi.fn();
const getDownloadUrlMock = vi.fn();
const deleteMock = vi.fn();
const listMock = vi.fn();
const publishMock = vi.fn();

function makeCtxFactory(): PlatformContextFactory {
  return {
    create: () => ({
      files: { get: getMock, getDownloadUrl: getDownloadUrlMock, delete: deleteMock, list: listMock, upload: vi.fn() },
      events: { publish: publishMock },
    }),
  } as unknown as PlatformContextFactory;
}

describe('purchase-service attachment RBAC — download', () => {
  beforeEach(() => {
    getMock.mockReset();
    getDownloadUrlMock.mockReset();
  });

  it('GRN attachment download with only PO_VIEW (no GRN_VIEW) → 403', async () => {
    getMock.mockResolvedValue({ id: 5, entityType: 'GRN', entityId: 1 });
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'GET',
      url: '/attachments/5/download',
      headers: authHeader(['PO_VIEW']),
    });

    expect(res.statusCode).toBe(403);
    expect(getDownloadUrlMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('GRN attachment download with GRN_VIEW → 302 redirect', async () => {
    getMock.mockResolvedValue({ id: 5, entityType: 'GRN', entityId: 1 });
    getDownloadUrlMock.mockResolvedValue({ url: 'https://example.com/f.pdf', fileName: 'f.pdf' });
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'GET',
      url: '/attachments/5/download',
      headers: authHeader(['GRN_VIEW']),
    });

    expect(res.statusCode).toBe(302);
    await app.close();
  });

  it('PURCHASE_ORDER attachment download with only GRN_VIEW (no PO_VIEW) → 403', async () => {
    getMock.mockResolvedValue({ id: 6, entityType: 'PURCHASE_ORDER', entityId: 1 });
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'GET',
      url: '/attachments/6/download',
      headers: authHeader(['GRN_VIEW']),
    });

    expect(res.statusCode).toBe(403);
    expect(getDownloadUrlMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('purchase-service attachment RBAC — delete', () => {
  beforeEach(() => {
    getMock.mockReset();
    deleteMock.mockReset();
    publishMock.mockReset();
  });

  it('GRN attachment delete with only PO_UPDATE (no GRN_UPDATE) → 403, never deletes', async () => {
    getMock.mockResolvedValue({ id: 5, entityType: 'GRN', entityId: 1 });
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'DELETE',
      url: '/attachments/5',
      headers: authHeader(['PO_UPDATE']),
    });

    expect(res.statusCode).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('GRN attachment delete with GRN_UPDATE → 204, deletes', async () => {
    getMock.mockResolvedValue({ id: 5, entityType: 'GRN', entityId: 1 });
    deleteMock.mockResolvedValue(undefined);
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'DELETE',
      url: '/attachments/5',
      headers: authHeader(['GRN_UPDATE']),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith(5);
    await app.close();
  });
});

describe('purchase-service attachment RBAC — list', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('listing GRN attachments with only PO_VIEW (no GRN_VIEW) → 403', async () => {
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'GET',
      url: '/attachments?entityType=GRN&entityId=1',
      headers: authHeader(['PO_VIEW']),
    });

    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('listing PURCHASE_ORDER attachments with PO_VIEW → 200', async () => {
    listMock.mockResolvedValue([]);
    const app = Fastify({ logger: false });
    await attachmentRoutes(app, makeCtxFactory());

    const res = await app.inject({
      method: 'GET',
      url: '/attachments?entityType=PURCHASE_ORDER&entityId=1',
      headers: authHeader(['PO_VIEW']),
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
