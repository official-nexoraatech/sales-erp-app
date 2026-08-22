/**
 * Purchase audit 2026-07-21 gap-closure — branch-level PO access control. purchaseOrders.branchId
 * was stored but never enforced: any caller holding PO_VIEW/PO_CREATE/etc could see or act on
 * every branch's POs, not just their own assigned branch(es). Covers both the read path
 * (GET /purchase-orders/:id) and a mutating path (POST /purchase-orders/:id/submit) via
 * assertPoBranchInScope, plus the BRANCH_SCOPE_BYPASS/no-branch-assignment escape hatches.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { purchaseOrderRoutes } from '../api/purchase-order.routes.js';

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

vi.mock('@erp/db', () => ({
  purchaseOrders: {
    id: 'id',
    tenantId: 'tenant_id',
    branchId: 'branch_id',
    status: 'status',
    supplierId: 'supplier_id',
    poNumber: 'po_number',
    poDate: 'po_date',
  },
  purchaseOrderLines: { id: 'id', purchaseOrderId: 'purchase_order_id' },
  purchaseOrderHistory: { purchaseOrderId: 'purchase_order_id', tenantId: 'tenant_id' },
  purchaseOrderAmendments: {},
  suppliers: { id: 'id', tenantId: 'tenant_id', displayName: 'display_name' },
  items: { id: 'id', name: 'name' },
  projectionSupplierBalance: { tenantId: 'tenant_id', supplierId: 'supplier_id' },
  outboxEvents: {},
  organizationSettings: {
    tenantId: 'tenant_id',
    purchaseApprovalThreshold: 'purchase_approval_threshold',
  },
}));

function authHeader(opts: { permissions: string[]; branchIds: number[] }): Record<string, string> {
  return {
    authorization: `Bearer ${JSON.stringify({
      sub: '1',
      userId: 1,
      tenantId: 1,
      email: 't@test.com',
      roles: [],
      branchIds: opts.branchIds,
      permissions: opts.permissions,
    })}`,
  };
}

// Sequential-script query builder mock, same shape as PurchaseOrderService's own unit tests
// (src/__tests__/purchase-workflow.test.ts) — every .select()/.update()/.insert() call consumes
// the next scripted response in call order.
function makeDbRaw(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'orderBy',
    'insert',
    'values',
    'update',
    'set',
    'leftJoin',
    'limit',
    'offset',
    'for',
  ]) {
    chainable[m] = () => chainable;
  }
  chainable['returning'] = () => next();
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  chainable['transaction'] = (fn: (t: typeof chainable) => Promise<unknown>) => fn(chainable);
  chainable['execute'] = () => Promise.resolve();
  return chainable;
}

function makeCtxFactory(dbRaw: ReturnType<typeof makeDbRaw>): PlatformContextFactory {
  return {
    rawDb: dbRaw,
    create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
      db: { raw: dbRaw },
      tenant,
    }),
  } as unknown as PlatformContextFactory;
}

describe('GET /purchase-orders/:id — branch scope', () => {
  it('403s a branch-restricted caller whose branches do not include the PO', async () => {
    // getWithLines: [po row] then [lines array]
    const dbRaw = makeDbRaw([[{ id: 1, branchId: 9, supplierId: 5, grandTotal: '100' }], []]);
    const app = Fastify({ logger: false });
    await purchaseOrderRoutes(app, makeCtxFactory(dbRaw));

    const res = await app.inject({
      method: 'GET',
      url: '/purchase-orders/1',
      headers: authHeader({ permissions: ['PO_VIEW'], branchIds: [1, 2] }), // PO is branch 9
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('200s a branch-restricted caller whose branches include the PO', async () => {
    const dbRaw = makeDbRaw([[{ id: 1, branchId: 1, supplierId: 5, grandTotal: '100' }], []]);
    const app = Fastify({ logger: false });
    await purchaseOrderRoutes(app, makeCtxFactory(dbRaw));

    const res = await app.inject({
      method: 'GET',
      url: '/purchase-orders/1',
      headers: authHeader({ permissions: ['PO_VIEW'], branchIds: [1, 2] }), // PO is branch 1
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('a caller with BRANCH_SCOPE_BYPASS sees a PO outside their own branches', async () => {
    const dbRaw = makeDbRaw([[{ id: 1, branchId: 9, supplierId: 5, grandTotal: '100' }], []]);
    const app = Fastify({ logger: false });
    await purchaseOrderRoutes(app, makeCtxFactory(dbRaw));

    const res = await app.inject({
      method: 'GET',
      url: '/purchase-orders/1',
      headers: authHeader({ permissions: ['PO_VIEW', 'BRANCH_SCOPE_BYPASS'], branchIds: [1, 2] }),
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('a caller with no branch assignments at all is treated as unrestricted (not locked out)', async () => {
    const dbRaw = makeDbRaw([[{ id: 1, branchId: 9, supplierId: 5, grandTotal: '100' }], []]);
    const app = Fastify({ logger: false });
    await purchaseOrderRoutes(app, makeCtxFactory(dbRaw));

    const res = await app.inject({
      method: 'GET',
      url: '/purchase-orders/1',
      headers: authHeader({ permissions: ['PO_VIEW'], branchIds: [] }),
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('POST /purchase-orders/:id/submit — branch scope', () => {
  it('403s a branch-restricted caller before the PO is ever mutated', async () => {
    // assertPoBranchInScope's own lookup: [{ branchId: 9 }]
    const dbRaw = makeDbRaw([[{ branchId: 9 }]]);
    const app = Fastify({ logger: false });
    await purchaseOrderRoutes(app, makeCtxFactory(dbRaw));

    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders/1/submit',
      headers: authHeader({ permissions: ['PO_CREATE'], branchIds: [1, 2] }), // PO is branch 9
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('allows a branch-restricted caller whose branches include the PO to submit it', async () => {
    const dbRaw = makeDbRaw([
      [{ branchId: 1 }], // assertPoBranchInScope lookup
      [{ id: 1, tenantId: 1, status: 'DRAFT' }], // PurchaseOrderService.submit's own select
      undefined, // update
      undefined, // history insert
    ]);
    const app = Fastify({ logger: false });
    await purchaseOrderRoutes(app, makeCtxFactory(dbRaw));

    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders/1/submit',
      headers: authHeader({ permissions: ['PO_CREATE'], branchIds: [1, 2] }), // PO is branch 1
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
